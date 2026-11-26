"""Contratos de los backends de IA. El pipeline solo conoce estas interfaces: añadir un modelo
nuevo (otro aligner, otro separador) no obliga a tocar el pipeline ni la API."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

Progress = Callable[[float, str], None]  # (fracción 0..1 dentro de la etapa, mensaje)


@dataclass
class RawWord:
    """Palabra tal como la entrega un motor. Tiempos en SEGUNDOS; pueden faltar."""

    text: str
    start: float | None
    end: float | None
    score: float | None = None


@dataclass
class TranscriptionResult:
    language: str | None
    words: list[RawWord]
    # Índices de palabra donde el motor marcó fin de segmento/frase (ayuda a agrupar líneas).
    segment_starts: list[int] = field(default_factory=list)
    transcriber: str = ""
    aligner: str = ""


@dataclass
class AlignmentResult:
    language: str | None
    words: list[RawWord]
    aligner: str = ""
    # "forced" si se alineó el texto con el audio; "transferred" si se emparejó con una transcripción.
    method: str = "forced"


class Backend(Protocol):
    name: str
    is_demo: bool
    device: str | None

    def can_separate(self) -> bool: ...

    def separate_vocals(self, wav: Path, out_dir: Path, progress: Progress) -> Path:
        """Devuelve la ruta de un WAV solo con la voz."""

    def transcribe(
        self, wav: Path, *, language: str | None, model_size: str, progress: Progress
    ) -> TranscriptionResult:
        """Transcribe y devuelve palabras con tiempos."""

    def align_lyrics(
        self, wav: Path, lines: list[str], *, language: str | None, model_size: str, duration_s: float,
        progress: Progress,
    ) -> AlignmentResult:
        """Alinea una letra existente con el audio."""

    def close(self) -> None: ...


class BackendError(Exception):
    """Fallo de un backend con mensaje apto para el usuario."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class JobCancelled(Exception):
    """Lanzada desde el callback de progreso cuando el usuario cancela el trabajo."""
