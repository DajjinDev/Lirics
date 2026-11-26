"""Fixtures: audio sintético generado con ffmpeg (tono / silencio). No se usa música real."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.audio import ffmpeg_available

needs_ffmpeg = pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg/ffprobe no disponibles")


def _make_wav(path: Path, segments: list[tuple[str, float]]) -> Path:
    """segments: [("tone"|"silence", segundos), ...] → WAV mono 16 kHz."""
    inputs: list[str] = []
    for kind, dur in segments:
        if kind == "tone":
            inputs += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=16000:duration={dur}"]
        else:
            inputs += ["-f", "lavfi", "-i", f"anullsrc=r=16000:cl=mono:d={dur}"]
    n = len(segments)
    cmd = ["ffmpeg", "-nostdin", "-y", "-v", "error", *inputs,
           "-filter_complex", f"concat=n={n}:v=0:a=1", "-ac", "1", "-ar", "16000", str(path)]
    subprocess.run(cmd, check=True)  # noqa: S603
    return path


@pytest.fixture(scope="session")
def tone_silence_wav(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """0–2 s tono · 2–5 s SILENCIO · 5–7 s tono (7 s en total)."""
    return _make_wav(tmp_path_factory.mktemp("audio") / "ts.wav", [("tone", 2), ("silence", 3), ("tone", 2)])


@pytest.fixture(scope="session")
def short_wav(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """12 s de tono continuo."""
    return _make_wav(tmp_path_factory.mktemp("audio") / "short.wav", [("tone", 12)])
