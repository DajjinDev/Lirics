"""Utilidades de audio basadas en ffmpeg/ffprobe.

Todas las llamadas usan listas de argumentos (sin shell) y rutas generadas por el
servicio, nunca nombres de archivo del usuario.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


class AudioError(Exception):
    """Error de audio con mensaje apto para mostrar al usuario."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AudioInfo:
    duration_ms: int
    codec: str
    sample_rate: int | None
    channels: int | None


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _run(args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(  # noqa: S603 - lista de argumentos, sin shell
            args, capture_output=True, text=True, timeout=timeout, check=False, encoding="utf-8", errors="replace"
        )
    except FileNotFoundError as e:
        raise AudioError("ffmpeg_missing", "ffmpeg no está instalado o no está en el PATH.") from e
    except subprocess.TimeoutExpired as e:
        raise AudioError("timeout", "El procesamiento del audio tardó demasiado.") from e


def probe(path: Path, *, max_duration_s: int) -> AudioInfo:
    """Valida que sea audio real (por contenido, no por extensión) y de duración admisible."""
    p = _run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        timeout=30,
    )
    if p.returncode != 0:
        raise AudioError("not_audio", "El archivo no es un audio válido o está dañado.")
    try:
        data = json.loads(p.stdout)
    except json.JSONDecodeError as e:
        raise AudioError("not_audio", "No se pudo leer la información del audio.") from e

    stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if stream is None:
        raise AudioError("not_audio", "El archivo no contiene una pista de audio.")

    raw = (data.get("format") or {}).get("duration") or stream.get("duration")
    try:
        duration_s = float(raw)
    except (TypeError, ValueError) as e:
        raise AudioError("not_audio", "No se pudo determinar la duración del audio.") from e
    if duration_s <= 0.5:
        raise AudioError("too_short", "El audio es demasiado corto.")
    if duration_s > max_duration_s:
        raise AudioError(
            "too_long",
            f"El audio dura {duration_s / 60:.1f} min; el máximo permitido es {max_duration_s // 60} min.",
        )
    return AudioInfo(
        duration_ms=round(duration_s * 1000),
        codec=str(stream.get("codec_name", "?")),
        sample_rate=int(stream["sample_rate"]) if stream.get("sample_rate") else None,
        channels=int(stream["channels"]) if stream.get("channels") else None,
    )


def to_wav16k_mono(src: Path, dst: Path) -> Path:
    """Convierte a WAV PCM 16 kHz mono, el formato que esperan los modelos."""
    p = _run(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
         "-c:a", "pcm_s16le", str(dst)],
        timeout=600,
    )
    if p.returncode != 0 or not dst.exists():
        raise AudioError("convert_failed", "No se pudo convertir el audio.")
    return dst


_SIL_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SIL_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


def parse_silencedetect(stderr: str, duration_ms: int) -> list[tuple[int, int]]:
    """Interpreta la salida del filtro silencedetect de ffmpeg → [(inicio_ms, fin_ms)]."""
    spans: list[tuple[int, int]] = []
    start: float | None = None
    for line in stderr.splitlines():
        m = _SIL_START.search(line)
        if m:
            start = max(0.0, float(m.group(1)))
            continue
        m = _SIL_END.search(line)
        if m and start is not None:
            spans.append((round(start * 1000), min(duration_ms, round(float(m.group(1)) * 1000))))
            start = None
    if start is not None:  # el audio termina en silencio
        spans.append((round(start * 1000), duration_ms))
    return [(a, b) for a, b in spans if b > a]


def detect_silences(wav: Path, duration_ms: int, *, noise_db: int = -35, min_s: float = 0.8) -> list[tuple[int, int]]:
    """Intervalos sin señal (≥ min_s) medidos sobre el propio audio."""
    p = _run(
        ["ffmpeg", "-nostdin", "-v", "info", "-i", str(wav), "-af", f"silencedetect=noise={noise_db}dB:d={min_s}",
         "-f", "null", "-"],
        timeout=300,
    )
    if p.returncode != 0:
        raise AudioError("silence_failed", "No se pudieron analizar los silencios.")
    return parse_silencedetect(p.stderr, duration_ms)
