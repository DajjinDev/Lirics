"""Modelos de la API. Tiempos en MILISEGUNDOS (igual que el frontend de Liriks)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ModelSize = Literal["tiny", "base", "small", "medium", "large-v3"]
JobState = Literal["queued", "running", "done", "error", "cancelled"]
Stage = Literal[
    "queued", "validating", "preparing", "separating", "transcribing", "aligning", "building", "done"
]


class Word(BaseModel):
    text: str
    start_ms: int
    end_ms: int
    # 0..1 si el motor lo entrega; None cuando el tiempo es interpolado.
    score: float | None = None
    interpolated: bool = False


class Line(BaseModel):
    id: str
    text: str
    start_ms: int
    end_ms: int
    words: list[Word] = Field(default_factory=list)
    confidence: float = 0.0
    # Avisos legibles por máquina: low_confidence, interpolated_words, fast_speech, in_silence, repetition
    flags: list[str] = Field(default_factory=list)


class Break(BaseModel):
    """Intervalo sin voz (intro, puente instrumental) medido sobre el audio."""

    start_ms: int
    end_ms: int


class Engine(BaseModel):
    backend: str  # "whisperx" | "fake"
    transcriber: str | None = None
    aligner: str | None = None
    separator: str | None = None
    device: str | None = None
    # true si el resultado NO proviene de un modelo real (solo el backend de demostración).
    demo: bool = False


class Result(BaseModel):
    language: str | None
    duration_ms: int
    # "transcribed": la letra salió de la transcripción; "aligned_provided": se alineó la letra
    # aportada por el usuario con el audio (forzada); "transferred_provided": letra aportada
    # emparejada con una transcripción (plan B).
    mode: Literal["transcribed", "aligned_provided", "transferred_provided"]
    engine: Engine
    lines: list[Line]
    breaks: list[Break] = Field(default_factory=list)
    overall_confidence: float
    warnings: list[str] = Field(default_factory=list)


class JobStatus(BaseModel):
    id: str
    state: JobState
    stage: Stage
    progress: float = 0.0  # 0..1
    message: str = ""
    error: str | None = None
    result: Result | None = None


class CreateJobResponse(BaseModel):
    id: str


class Health(BaseModel):
    status: Literal["ok"]
    backend: str
    ffmpeg: bool
    whisperx: bool
    demucs: bool
    device: str | None
    limits: dict[str, int]
