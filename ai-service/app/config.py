"""Configuración por variables de entorno (prefijo LIRIKS_AI_). Valores por defecto seguros."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


def _csv(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    # "auto": usa WhisperX/Demucs si están instalados; "fake": backend de demostración
    # (determinista, sin IA, claramente identificado); "whisperx": exige WhisperX.
    backend: str = "auto"
    # Solo escucha en local por defecto: el servicio procesa audio del usuario.
    host: str = "127.0.0.1"
    port: int = 8765
    allowed_origins: list[str] = field(
        default_factory=lambda: ["http://localhost:4200", "http://127.0.0.1:4200"]
    )
    max_upload_mb: int = 100
    max_duration_s: int = 15 * 60
    max_lyrics_chars: int = 40_000
    # Los trabajos y su audio se descartan pasado este tiempo desde que terminan.
    job_ttl_s: int = 30 * 60
    work_dir: Path = field(default_factory=lambda: Path(tempfile.gettempdir()) / "liriks-ai")
    # Modelos y rendimiento (RTX 3050 6 GB: small/medium en float16 caben; large-v3 requiere int8).
    default_model: str = "small"
    device: str = "auto"  # auto | cuda | cpu
    batch_size: int = 4
    demucs_model: str = "htdemucs"

    @staticmethod
    def from_env() -> "Settings":
        g = os.environ.get
        d = Settings()
        return Settings(
            backend=g("LIRIKS_AI_BACKEND", d.backend),
            host=g("LIRIKS_AI_HOST", d.host),
            port=int(g("LIRIKS_AI_PORT", d.port)),
            allowed_origins=_csv(g("LIRIKS_AI_ORIGINS", ",".join(d.allowed_origins))),
            max_upload_mb=int(g("LIRIKS_AI_MAX_UPLOAD_MB", d.max_upload_mb)),
            max_duration_s=int(g("LIRIKS_AI_MAX_DURATION_S", d.max_duration_s)),
            job_ttl_s=int(g("LIRIKS_AI_JOB_TTL_S", d.job_ttl_s)),
            work_dir=Path(g("LIRIKS_AI_WORK_DIR", str(d.work_dir))),
            default_model=g("LIRIKS_AI_MODEL", d.default_model),
            device=g("LIRIKS_AI_DEVICE", d.device),
            batch_size=int(g("LIRIKS_AI_BATCH_SIZE", d.batch_size)),
            demucs_model=g("LIRIKS_AI_DEMUCS_MODEL", d.demucs_model),
        )
