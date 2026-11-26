"""Valida el pipeline con modelos REALES contra audio con verdad conocida.

No es parte de `pytest` (necesita torch/whisperx, GPU y descargar modelos). Uso:

    python tests/tools/validate_real_ai.py <carpeta_audio> <informe.json> [modelo]

La carpeta debe contener `verdad.json`, `voz-es.wav`, `voz-en.wav` y `mix-en.wav` (los genera
make_test_audio.ps1 + el mezclador). La "verdad" son los instantes de inicio de cada palabra que
reporta la síntesis de voz. OJO: es habla sintética, no canto.
"""

from __future__ import annotations

import json
import shutil
import statistics
import sys
import tempfile
import time
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.alignment_text import norm  # noqa: E402
from app.backends.whisperx_backend import WhisperXBackend  # noqa: E402
from app.config import Settings  # noqa: E402
from app.models import Result  # noqa: E402
from app.pipeline import Options, run_pipeline  # noqa: E402


def load_truth(folder: Path) -> dict:
    return json.loads((folder / "verdad.json").read_text(encoding="utf-8-sig"))


def compare(result: Result, truth_words: list[dict], offset_ms: float = 0.0) -> dict:
    """Empareja las palabras del resultado con la verdad y mide el error de inicio."""
    hyp = [w for ln in result.lines for w in ln.words]
    a = [norm(w["text"]) for w in truth_words]
    b = [norm(w.text) for w in hyp]
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    errs: list[float] = []
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            errs.append(hyp[blk.b + k].start_ms - (truth_words[blk.a + k]["start_ms"] + offset_ms))
    n = len(truth_words)
    absd = sorted(abs(e) for e in errs)
    return {
        "palabras_verdad": n,
        "palabras_resultado": len(hyp),
        "emparejadas": len(errs),
        "cobertura": round(len(errs) / n, 3) if n else 0,
        "wer_aprox": round(1 - len(errs) / n, 3) if n else None,
        "error_mediano_ms": round(statistics.median(absd)) if absd else None,
        "error_p90_ms": round(absd[int(len(absd) * 0.9) - 1]) if absd else None,
        "error_max_ms": round(absd[-1]) if absd else None,
        "sesgo_medio_ms": round(statistics.mean(errs)) if errs else None,
        "dentro_100ms": round(sum(1 for e in absd if e <= 100) / len(absd), 3) if absd else None,
        "dentro_250ms": round(sum(1 for e in absd if e <= 250) / len(absd), 3) if absd else None,
    }


def main() -> None:
    folder, report_path = Path(sys.argv[1]), Path(sys.argv[2])
    model = sys.argv[3] if len(sys.argv) > 3 else "small"
    truth = load_truth(folder)
    work = Path(tempfile.mkdtemp(prefix="liriks-real-"))
    settings = Settings(work_dir=work, max_duration_s=300, default_model=model)

    import torch  # noqa: PLC0415

    report: dict = {"modelo": model, "cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, "casos": {}}
    t0 = time.time()
    backend = WhisperXBackend(settings)
    report["dispositivo"] = backend.device
    report["tiempo_carga_backend_s"] = round(time.time() - t0, 1)

    def run(name: str, src: Path, opts: Options, truth_words: list[dict], offset: float = 0.0) -> None:
        up = work / f"{name}.bin"
        shutil.copy(src, up)
        stages: list[str] = []
        t = time.time()
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        try:
            res = run_pipeline(
                up, work / name, opts, backend, settings,
                report=lambda st, p, m: stages.append(f"{st}:{p:.2f}") if not stages or not stages[-1].startswith(st) else None,
                is_cancelled=lambda: False,
            )
        except Exception as e:  # noqa: BLE001
            report["casos"][name] = {"ERROR": f"{type(e).__name__}: {e}"}
            print(f"[{name}] ERROR {type(e).__name__}: {e}")
            return
        elapsed = time.time() - t
        info = {
            "tiempo_s": round(elapsed, 1),
            "vram_pico_mb": round(torch.cuda.max_memory_allocated() / 1e6) if torch.cuda.is_available() else None,
            "idioma": res.language,
            "modo": res.mode,
            "motor": res.engine.model_dump(),
            "confianza_global": res.overall_confidence,
            "lineas": [ln.text for ln in res.lines],
            "avisos": res.warnings,
            "pausas": [(b.start_ms, b.end_ms) for b in res.breaks],
            "primera_palabra_ms": res.lines[0].words[0].start_ms if res.lines and res.lines[0].words else None,
            "precision": compare(res, truth_words, offset),
        }
        report["casos"][name] = info
        print(f"[{name}] {elapsed:.1f}s · precisión: {json.dumps(info['precision'], ensure_ascii=False)}")
        print(f"   líneas: {info['lineas']}")

    es, en = truth["es"], truth["en"]
    # 1) Transcribir (sin letra): idioma detectado + palabras + alineación
    run("es-transcribir", folder / "voz-es.wav", Options(model_size=model), es["words"])
    run("en-transcribir", folder / "voz-en.wav", Options(model_size=model), en["words"])
    # 2) Alinear una letra aportada (la vía recomendada)
    run("es-letra-aportada", folder / "voz-es.wav", Options(model_size=model, lyrics_text="\n".join(es["lines"])), es["words"])
    run("en-letra-aportada", folder / "voz-en.wav", Options(model_size=model, lyrics_text="\n".join(en["lines"]), language="en"), en["words"])
    # 3) Voz sobre música con intro instrumental de 5 s: con y sin separación de voz
    run("mix-sin-separar", folder / "mix-en.wav", Options(model_size=model, lyrics_text="\n".join(en["lines"])), en["words"], 5000)
    run("mix-con-demucs", folder / "mix-en.wav", Options(model_size=model, lyrics_text="\n".join(en["lines"]), separate_vocals=True), en["words"], 5000)
    run("mix-transcribir-demucs", folder / "mix-en.wav", Options(model_size=model, separate_vocals=True), en["words"], 5000)

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nInforme:", report_path)
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
