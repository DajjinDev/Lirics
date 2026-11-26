"""Backend de DEMOSTRACIÓN. No usa IA: reparte palabras de forma uniforme sobre la duración.

Existe para desarrollar y probar el servicio y la interfaz sin instalar modelos pesados.
Todo resultado generado con él se marca `engine.demo = true` y los exportadores lo rotulan;
nunca debe presentarse como una sincronización real.
"""

from __future__ import annotations

import wave
from pathlib import Path

from ..alignment_text import tokenize
from .base import AlignmentResult, Progress, RawWord, TranscriptionResult

_PLACEHOLDER = "esto es una transcripcion de demostracion sin inteligencia artificial real"


def _duration_s(wav: Path) -> float:
    with wave.open(str(wav), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def _spread(tokens: list[str], duration_s: float) -> list[RawWord]:
    if not tokens:
        return []
    usable = max(0.1, duration_s - 0.2)
    step = usable / len(tokens)
    return [
        RawWord(text=t, start=0.1 + i * step, end=0.1 + (i + 1) * step * 0.9, score=0.9)
        for i, t in enumerate(tokens)
    ]


class FakeBackend:
    name = "fake"
    is_demo = True
    device: str | None = "none"

    def can_separate(self) -> bool:
        return True

    def separate_vocals(self, wav: Path, out_dir: Path, progress: Progress) -> Path:
        progress(1.0, "Separación simulada (demostración)")
        return wav  # sin separación real: se usa el mismo audio

    def transcribe(
        self, wav: Path, *, language: str | None, model_size: str, progress: Progress
    ) -> TranscriptionResult:
        dur = _duration_s(wav)
        # Repite la frase para cubrir audios largos (≈ 3 palabras por segundo).
        n = max(4, int(dur * 3))
        base = _PLACEHOLDER.split()
        tokens = [base[i % len(base)] for i in range(n)]
        progress(1.0, "Transcripción simulada (demostración)")
        return TranscriptionResult(
            language=language or "es",
            words=_spread(tokens, dur),
            segment_starts=list(range(0, n, 8)),
            transcriber="fake",
            aligner="fake",
        )

    def align_lyrics(
        self, wav: Path, lines: list[str], *, language: str | None, model_size: str, duration_s: float,
        progress: Progress,
    ) -> AlignmentResult:
        tokens = [t for line in lines for t in tokenize(line)]
        progress(1.0, "Alineación simulada (demostración)")
        return AlignmentResult(language=language or "es", words=_spread(tokens, duration_s), aligner="fake")

    def close(self) -> None:
        pass
