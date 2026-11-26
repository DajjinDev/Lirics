"""Pipeline de sincronización: audio autorizado → líneas con tiempos por palabra y confianza.

Etapas (fracción global del progreso):
  validating 0–5 % · preparing 5–10 % · separating 10–35 % (opcional) · transcribing/aligning 35–90 %
  · building 90–100 %.
El audio original se elimina en cuanto se convierte; el servicio no conserva audio de los usuarios.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import audio
from .alignment_text import map_words_to_lines, parse_lyrics_text
from .backends.base import Backend, JobCancelled
from .config import Settings
from .models import Engine, Result, Stage
from .postprocess import (
    apply_silences,
    breaks_from_lines,
    breaks_from_silences,
    finalize_words,
    flag_repetitions,
    group_into_lines,
    lines_from_mapped,
    overall_confidence,
)

Report = Callable[[Stage, float, str], None]


@dataclass(frozen=True)
class Options:
    language: str | None = None
    lyrics_text: str | None = None
    separate_vocals: bool = False
    model_size: str = "small"
    title: str | None = None
    artist: str | None = None


def _scaled(report: Report, stage: Stage, lo: float, hi: float, is_cancelled: Callable[[], bool]):
    """Callback de progreso para un backend: mapea 0..1 → [lo, hi] y propaga la cancelación."""

    def cb(fraction: float, message: str) -> None:
        if is_cancelled():
            raise JobCancelled()
        report(stage, lo + (hi - lo) * max(0.0, min(1.0, fraction)), message)

    return cb


def run_pipeline(
    upload: Path,
    work_dir: Path,
    options: Options,
    backend: Backend,
    settings: Settings,
    report: Report,
    is_cancelled: Callable[[], bool],
) -> Result:
    def check() -> None:
        if is_cancelled():
            raise JobCancelled()

    warnings: list[str] = []
    work_dir.mkdir(parents=True, exist_ok=True)

    # 1) Validación real del contenido (ffprobe), no de la extensión
    report("validating", 0.01, "Comprobando el audio…")
    info = audio.probe(upload, max_duration_s=settings.max_duration_s)
    check()

    # 2) Conversión al formato de los modelos; el original ya no se necesita
    report("preparing", 0.06, "Preparando el audio…")
    wav = audio.to_wav16k_mono(upload, work_dir / "audio16k.wav")
    upload.unlink(missing_ok=True)
    check()

    # 3) Separación de voz (opcional)
    working = wav
    separated = False
    if options.separate_vocals:
        if backend.can_separate():
            raw = backend.separate_vocals(wav, work_dir / "stems", _scaled(report, "separating", 0.10, 0.35, is_cancelled))
            working = audio.to_wav16k_mono(raw, work_dir / "vocals16k.wav") if raw != wav else wav
            separated = raw != wav
            if not separated:
                warnings.append("La separación de voz es simulada en el modo de demostración.")
        else:
            warnings.append("No se pudo separar la voz (Demucs no disponible): se usó la mezcla completa.")
    check()

    # 4) Transcripción o alineación de la letra aportada
    lines_text = parse_lyrics_text(options.lyrics_text) if options.lyrics_text else []
    transcribe_cb = _scaled(report, "transcribing", 0.35, 0.90, is_cancelled)

    if lines_text:
        report("aligning", 0.36, "Alineando la letra con el audio…")
        aligned = backend.align_lyrics(
            working, lines_text, language=options.language, model_size=options.model_size,
            duration_s=info.duration_ms / 1000, progress=_scaled(report, "aligning", 0.35, 0.90, is_cancelled),
        )
        mapped = map_words_to_lines(lines_text, aligned.words)
        lines = lines_from_mapped(mapped, info.duration_ms)
        mode = "aligned_provided" if aligned.method == "forced" else "transferred_provided"
        language, transcriber, aligner = aligned.language, None, aligned.aligner
        if mode == "transferred_provided":
            warnings.append(
                "La alineación forzada no fue posible; los tiempos se copiaron de una transcripción. "
                "Las palabras sin pareja tienen tiempo interpolado: revísalas."
            )
    else:
        report("transcribing", 0.36, "Transcribiendo el audio…")
        tr = backend.transcribe(working, language=options.language, model_size=options.model_size, progress=transcribe_cb)
        words = finalize_words(tr.words, info.duration_ms)
        lines = group_into_lines(words, set(tr.segment_starts))
        mode = "transcribed"
        language, transcriber, aligner = tr.language, tr.transcriber, tr.aligner
        if aligner.startswith("segments"):
            warnings.append(
                "Este idioma no tiene alineador por palabra: los tiempos son por segmento y menos precisos."
            )
        warnings.append("La letra proviene de una transcripción automática: puede contener errores. Revísala.")
    check()

    if not lines:
        raise audio.AudioError(
            "no_speech", "No se detectó voz o letra en el audio. Prueba a separar la voz o a aportar la letra."
        )

    # 5) Construcción: silencios medidos, repeticiones, pausas y confianza
    report("building", 0.92, "Analizando silencios y confianza…")
    silences = audio.detect_silences(working, info.duration_ms) if separated else None
    in_silence = apply_silences(lines, silences) if silences is not None else 0
    repeated = flag_repetitions(lines)
    breaks = breaks_from_silences(silences) if silences is not None else breaks_from_lines(lines, info.duration_ms)
    overall = overall_confidence(lines)

    low = sum(1 for ln in lines if "low_confidence" in ln.flags)
    fast = sum(1 for ln in lines if "fast_speech" in ln.flags)
    if overall < 0.6:
        warnings.append(f"Confianza global baja ({overall:.0%}): revisa la sincronía manualmente.")
    if low and low / len(lines) > 0.3:
        warnings.append(f"{low} de {len(lines)} líneas tienen baja confianza (voces superpuestas, coros o ruido).")
    if in_silence:
        warnings.append(f"{in_silence} línea(s) caen sobre tramos sin voz detectada: probablemente están mal situadas.")
    if repeated:
        warnings.append(f"{repeated} líneas idénticas seguidas: posible alucinación del modelo en un tramo sin voz.")
    if fast:
        warnings.append(f"{fast} línea(s) con ritmo muy rápido (p. ej. rap): la precisión por palabra puede ser menor.")
    if backend.is_demo:
        warnings.insert(0, "RESULTADO DE DEMOSTRACIÓN: no se usó ningún modelo de IA, los tiempos no son reales.")

    report("done", 1.0, "Listo")
    return Result(
        language=language,
        duration_ms=info.duration_ms,
        mode=mode,  # type: ignore[arg-type]
        engine=Engine(
            backend=backend.name, transcriber=transcriber, aligner=aligner,
            separator=(settings.demucs_model if separated else None), device=backend.device, demo=backend.is_demo,
        ),
        lines=lines,
        breaks=breaks,
        overall_confidence=overall,
        warnings=warnings,
    )
