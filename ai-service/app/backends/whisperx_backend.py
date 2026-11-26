"""Backend real: WhisperX (transcripción + alineación forzada wav2vec2) y Demucs (separación de voz).

Escrito contra las firmas de whisperx 3.8.6 y demucs 4.1.0 (leídas del código fuente de sus ruedas):

    model = whisperx.load_model(arch, device, compute_type=..., language=None)
    result = model.transcribe(audio, batch_size=N, language=None)   # {"segments", "language"}
    align_model, meta = whisperx.load_align_model(language_code=..., device=...)
    aligned = whisperx.align(segments, align_model, meta, audio, device)  # words: word/start/end/score

Las dependencias pesadas (torch, whisperx) se importan de forma perezosa: el servicio arranca
aunque no estén instaladas y entonces usa el backend de demostración.

AVISO: este módulo requiere `pip install -r requirements-ml.txt`. Sus rutas de IA se ejecutan
solo cuando esas dependencias existen; los tests del repositorio no las cargan.
"""

from __future__ import annotations

import gc
import importlib.util
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from ..alignment_text import norm, tokenize, transfer_timestamps
from ..config import Settings
from .base import (
    AlignmentResult,
    BackendError,
    JobCancelled,
    Progress,
    RawWord,
    TranscriptionResult,
)

_PCT = re.compile(r"(\d{1,3})%")


def whisperx_installed() -> bool:
    return importlib.util.find_spec("whisperx") is not None


def demucs_installed() -> bool:
    return importlib.util.find_spec("demucs") is not None


class WhisperXBackend:
    name = "whisperx"
    is_demo = False

    def __init__(self, settings: Settings):
        if not whisperx_installed():
            raise BackendError(
                "whisperx_missing", "WhisperX no está instalado. Ejecuta: pip install -r requirements-ml.txt"
            )
        self.settings = settings
        self._lock = threading.Lock()  # una sola inferencia a la vez (GPU compartida)
        self._asr_key: str | None = None
        self._asr: Any = None
        self._align_lang: str | None = None
        self._align: Any = None
        self.device: str | None = self._resolve_device()

    # ------------------------------------------------------------------ infraestructura

    def _resolve_device(self) -> str:
        import torch  # noqa: PLC0415 - importación perezosa

        want = self.settings.device
        if want == "cuda" and not torch.cuda.is_available():
            raise BackendError("no_cuda", "Se pidió CUDA pero PyTorch no ve ninguna GPU.")
        if want in ("cuda", "cpu"):
            return want
        return "cuda" if torch.cuda.is_available() else "cpu"

    def _compute_type(self, model_size: str) -> str:
        if self.device == "cpu":
            return "int8"
        # large-v3 en float16 no cabe en 6 GB de VRAM junto al alineador.
        return "int8_float16" if model_size == "large-v3" else "float16"

    def can_separate(self) -> bool:
        return demucs_installed()

    def _free_gpu(self) -> None:
        gc.collect()
        try:
            import torch  # noqa: PLC0415

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001 - limpieza best-effort
            pass

    def _get_asr(self, model_size: str) -> Any:
        import whisperx  # noqa: PLC0415

        if self._asr_key != model_size:
            self._asr = None
            self._free_gpu()  # solo un modelo de Whisper en memoria a la vez
            try:
                self._asr = whisperx.load_model(
                    model_size, self.device, compute_type=self._compute_type(model_size)
                )
            except Exception as e:  # noqa: BLE001
                raise BackendError("model_load_failed", f"No se pudo cargar el modelo Whisper «{model_size}»: {e}") from e
            self._asr_key = model_size
        return self._asr

    def _get_align(self, language: str) -> tuple[Any, Any]:
        import whisperx  # noqa: PLC0415

        if self._align_lang != language:
            self._align = None
            self._free_gpu()
            try:
                self._align = whisperx.load_align_model(language_code=language, device=self.device)
            except Exception as e:  # noqa: BLE001
                raise BackendError(
                    "align_unsupported", f"No hay modelo de alineación para el idioma «{language}»."
                ) from e
            self._align_lang = language
        return self._align

    # ------------------------------------------------------------------ separación (Demucs)

    def separate_vocals(self, wav: Path, out_dir: Path, progress: Progress) -> Path:
        if not demucs_installed():
            raise BackendError("demucs_missing", "Demucs no está instalado (pip install -r requirements-ml.txt).")
        out_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            sys.executable, "-m", "demucs.separate", "--two-stems", "vocals",
            "-n", self.settings.demucs_model, "-d", self.device or "cpu", "-o", str(out_dir), str(wav),
        ]
        progress(0.02, "Separando la voz con Demucs…")
        proc = subprocess.Popen(  # noqa: S603 - lista de argumentos, rutas generadas por el servicio
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace"
        )
        tail = ""
        try:
            assert proc.stderr is not None
            for chunk in iter(lambda: proc.stderr.read(128), ""):  # type: ignore[union-attr]
                tail = (tail + chunk)[-400:]
                m = _PCT.findall(chunk)
                if m:
                    progress(min(0.98, int(m[-1]) / 100), "Separando la voz con Demucs…")  # puede lanzar JobCancelled
        except JobCancelled:
            proc.kill()
            raise
        finally:
            proc.wait()
        if proc.returncode != 0:
            raise BackendError("separation_failed", f"Demucs falló: {tail.strip()[-200:]}")
        found = sorted(out_dir.glob("**/vocals.*"))
        if not found:
            raise BackendError("separation_failed", "Demucs no produjo el archivo de voz.")
        return found[0]

    # ------------------------------------------------------------------ transcripción

    def transcribe(
        self, wav: Path, *, language: str | None, model_size: str, progress: Progress
    ) -> TranscriptionResult:
        import whisperx  # noqa: PLC0415

        with self._lock:
            audio = whisperx.load_audio(str(wav))
            progress(0.02, f"Cargando modelo Whisper «{model_size}»…")
            asr = self._get_asr(model_size)
            progress(0.15, "Transcribiendo…")
            result = asr.transcribe(audio, batch_size=self.settings.batch_size, language=language)
            lang = result.get("language") or language
            segments = result.get("segments", [])
            progress(0.6, "Alineando palabras…")
            try:
                if not lang:
                    raise BackendError("no_language", "No se pudo detectar el idioma.")
                model, meta = self._get_align(lang)
                aligned = whisperx.align(segments, model, meta, audio, self.device, return_char_alignments=False)
                words, starts = _flatten(aligned.get("segments", []))
                aligner = f"wav2vec2 ({lang})"
            except BackendError:
                # Idioma sin modelo de alineación: tiempos por segmento (menos precisos), se avisa.
                words, starts = _words_from_segments(segments)
                aligner = "segments (sin alineación por palabra)"
            progress(1.0, "Transcripción lista")
            self._free_gpu()
            return TranscriptionResult(
                language=lang, words=words, segment_starts=starts,
                transcriber=f"whisper-{model_size}", aligner=aligner,
            )

    # ------------------------------------------------------------------ alineación de una letra existente

    def align_lyrics(
        self, wav: Path, lines: list[str], *, language: str | None, model_size: str, duration_s: float,
        progress: Progress,
    ) -> AlignmentResult:
        import whisperx  # noqa: PLC0415

        with self._lock:
            audio = whisperx.load_audio(str(wav))
            lang = language
            if not lang:
                progress(0.05, "Detectando el idioma…")
                asr = self._get_asr(model_size)
                probe = asr.transcribe(audio[: 16000 * 30], batch_size=1)
                lang = probe.get("language")
            if not lang:
                raise BackendError("no_language", "No se pudo detectar el idioma; indícalo manualmente.")

            progress(0.2, "Preparando la alineación forzada…")
            model, meta = self._get_align(lang)  # lanza align_unsupported si no existe
            text = " ".join(lines)
            segments = [{"text": text, "start": 0.0, "end": float(duration_s)}]
            try:
                progress(0.35, "Alineando la letra con el audio…")
                aligned = whisperx.align(segments, model, meta, audio, self.device, return_char_alignments=False)
                words, _ = _flatten(aligned.get("segments", []))
                self._free_gpu()
                return AlignmentResult(language=lang, words=words, aligner=f"wav2vec2 ({lang})", method="forced")
            except Exception as e:  # noqa: BLE001 - p. ej. falta de memoria en audios largos
                if _is_oom(e):
                    self._free_gpu()
                    progress(0.4, "Memoria insuficiente: usando transcripción + emparejado de texto…")
                else:
                    raise BackendError("align_failed", f"La alineación forzada falló: {e}") from e

        # Plan B (fuera del lock: transcribe lo toma): transcribir y copiar tiempos a la letra aportada.
        tr = self.transcribe(wav, language=lang, model_size=model_size, progress=lambda f, m: progress(0.4 + 0.5 * f, m))
        provided = [t for line in lines for t in tokenize(line)]
        return AlignmentResult(
            language=lang, words=transfer_timestamps(provided, tr.words), aligner=tr.aligner, method="transferred"
        )

    def close(self) -> None:
        self._asr = None
        self._align = None
        self._asr_key = self._align_lang = None
        self._free_gpu()


# ---------------------------------------------------------------------- utilidades (puras)


def _is_oom(e: BaseException) -> bool:
    return "out of memory" in str(e).lower() or type(e).__name__ == "OutOfMemoryError"


def _flatten(segments: list[dict]) -> tuple[list[RawWord], list[int]]:
    """Segmentos alineados de WhisperX → palabras planas + índices de inicio de segmento."""
    words: list[RawWord] = []
    starts: list[int] = []
    for seg in segments:
        seg_words = seg.get("words") or []
        if seg_words:
            starts.append(len(words))
        for w in seg_words:
            text = str(w.get("word", "")).strip()
            if text:
                words.append(RawWord(text, w.get("start"), w.get("end"), w.get("score")))
    return words, starts


def _words_from_segments(segments: list[dict]) -> tuple[list[RawWord], list[int]]:
    """Sin alineador: reparte cada segmento entre sus palabras por longitud (tiempos aproximados)."""
    words: list[RawWord] = []
    starts: list[int] = []
    for seg in segments:
        toks = tokenize(str(seg.get("text", "")))
        if not toks or seg.get("start") is None or seg.get("end") is None:
            continue
        starts.append(len(words))
        total = sum(max(1, len(norm(t)) or 1) for t in toks)
        cursor, span = float(seg["start"]), float(seg["end"]) - float(seg["start"])
        for t in toks:
            dur = span * max(1, len(norm(t)) or 1) / total
            words.append(RawWord(t, cursor, cursor + dur, None))
            cursor += dur
    return words, starts
