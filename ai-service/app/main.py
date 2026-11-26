"""API HTTP del servicio de IA de Liriks.

Seguridad: escucha solo en 127.0.0.1 por defecto, CORS restringido a los orígenes configurados,
tamaño y duración limitados, el contenido del audio se valida con ffprobe, no se aceptan URLs
(no se descarga nada de internet) y exige que el usuario confirme que tiene derechos sobre el audio.
"""

from __future__ import annotations

import logging
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from . import audio, exporters
from .backends.base import Backend, BackendError
from .backends.fake import FakeBackend
from .backends.whisperx_backend import WhisperXBackend, demucs_installed, whisperx_installed
from .config import Settings
from .jobs import JobManager
from .models import CreateJobResponse, Health, JobStatus
from .pipeline import Options

log = logging.getLogger("liriks.ai")

_ALLOWED_MODELS = {"tiny", "base", "small", "medium", "large-v3"}
_LANG = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")
_CHUNK = 1024 * 1024


def make_backend(settings: Settings) -> Backend:
    if settings.backend == "fake":
        return FakeBackend()
    if settings.backend == "whisperx":
        return WhisperXBackend(settings)
    # auto
    return WhisperXBackend(settings) if whisperx_installed() else FakeBackend()


def create_app(settings: Settings | None = None, backend: Backend | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    # El backend (y torch) se carga en el primer trabajo, no al arrancar.
    holder: dict[str, Backend | None] = {"b": backend}
    lock = threading.Lock()

    def get_backend() -> Backend:
        with lock:
            if holder["b"] is None:
                holder["b"] = make_backend(settings)
            return holder["b"]

    manager = JobManager(settings, get_backend)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        manager.shutdown()
        if holder["b"] is not None:
            holder["b"].close()

    app = FastAPI(title="Liriks AI", version="0.1.0", docs_url="/docs", redoc_url=None, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )
    app.state.manager = manager
    app.state.settings = settings

    # ------------------------------------------------------------------ rutas

    @app.get("/health", response_model=Health)
    def health() -> Health:
        b = holder["b"]
        effective = b.name if b else ("whisperx" if settings.backend != "fake" and whisperx_installed() else "fake")
        return Health(
            status="ok",
            backend=effective,
            ffmpeg=audio.ffmpeg_available(),
            whisperx=whisperx_installed(),
            demucs=demucs_installed(),
            device=b.device if b else None,
            limits={
                "max_upload_mb": settings.max_upload_mb,
                "max_duration_s": settings.max_duration_s,
                "max_lyrics_chars": settings.max_lyrics_chars,
            },
        )

    @app.post("/jobs", response_model=CreateJobResponse, status_code=202)
    async def create_job(
        request: Request,
        audio_file: UploadFile = File(..., alias="audio"),
        rights_confirmed: bool = Form(False),
        language: str | None = Form(None),
        lyrics_text: str | None = Form(None),
        separate_vocals: bool = Form(False),
        model_size: str = Form(settings.default_model),
        title: str | None = Form(None),
        artist: str | None = Form(None),
    ) -> CreateJobResponse:
        if not rights_confirmed:
            raise HTTPException(
                400,
                "Debes confirmar que tienes los derechos o la autorización para procesar este audio "
                "(rights_confirmed=true).",
            )
        if not audio.ffmpeg_available():
            raise HTTPException(503, "ffmpeg no está instalado en el servidor.")
        if model_size not in _ALLOWED_MODELS:
            raise HTTPException(422, f"Modelo no válido. Opciones: {', '.join(sorted(_ALLOWED_MODELS))}.")
        if language and not _LANG.match(language):
            raise HTTPException(422, "Código de idioma no válido (p. ej. 'es', 'en').")
        if lyrics_text and len(lyrics_text) > settings.max_lyrics_chars:
            raise HTTPException(413, f"La letra supera {settings.max_lyrics_chars} caracteres.")
        for label, value in (("title", title), ("artist", artist)):
            if value and len(value) > 200:
                raise HTTPException(422, f"«{label}» es demasiado largo.")

        limit = settings.max_upload_mb * 1024 * 1024
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limit + 64 * 1024:
            raise HTTPException(413, f"El archivo supera {settings.max_upload_mb} MB.")

        job_id, job_dir = manager.new_job_dir()
        # Nombre propio: el nombre que envía el cliente nunca toca el sistema de archivos.
        upload_path = job_dir / "upload.bin"
        try:
            size = 0
            with upload_path.open("wb") as out:
                while chunk := await audio_file.read(_CHUNK):
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(413, f"El archivo supera {settings.max_upload_mb} MB.")
                    out.write(chunk)
            if size == 0:
                raise HTTPException(422, "El archivo está vacío.")
            # Validación temprana del contenido para responder 422 de inmediato.
            try:
                audio.probe(upload_path, max_duration_s=settings.max_duration_s)
            except audio.AudioError as e:
                raise HTTPException(422, e.message) from e
        except HTTPException:
            _rm(job_dir)
            raise
        except Exception:
            _rm(job_dir)
            log.exception("Fallo al recibir el archivo")
            raise HTTPException(500, "No se pudo recibir el archivo.") from None

        manager.submit(
            job_id, job_dir, upload_path,
            Options(
                language=language or None,
                lyrics_text=lyrics_text or None,
                separate_vocals=separate_vocals,
                model_size=model_size,
                title=title or None,
                artist=artist or None,
            ),
        )
        return CreateJobResponse(id=job_id)

    @app.get("/jobs/{job_id}", response_model=JobStatus)
    def get_job(job_id: str) -> JobStatus:
        st = manager.status(job_id) if _valid_id(job_id) else None
        if st is None:
            raise HTTPException(404, "Trabajo no encontrado (puede haber caducado).")
        return st

    @app.delete("/jobs/{job_id}", status_code=204)
    def delete_job(job_id: str) -> None:
        if not _valid_id(job_id) or not manager.cancel_or_delete(job_id):
            raise HTTPException(404, "Trabajo no encontrado.")

    @app.get("/jobs/{job_id}/export", response_class=PlainTextResponse)
    def export(job_id: str, format: str = Query("lrc", pattern="^(lrc|lrc-enhanced|json)$")) -> PlainTextResponse:
        job = manager.job(job_id) if _valid_id(job_id) else None
        if job is None or job.result is None:
            raise HTTPException(404, "No hay un resultado disponible para ese trabajo.")
        o = job.options
        if format == "json":
            body = exporters.to_json(job.result, track_id=job_id, title=o.title, artist=o.artist)
            return PlainTextResponse(body, media_type="application/json; charset=utf-8",
                                     headers={"Content-Disposition": 'attachment; filename="lyrics.json"'})
        body = exporters.to_lrc(job.result, enhanced=format == "lrc-enhanced", title=o.title, artist=o.artist)
        return PlainTextResponse(body, media_type="text/plain; charset=utf-8",
                                 headers={"Content-Disposition": 'attachment; filename="lyrics.lrc"'})

    return app


_ID = re.compile(r"^[0-9a-f]{32}$")


def _valid_id(job_id: str) -> bool:
    return bool(_ID.match(job_id))


def _rm(path: Path) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)


# Instancia para `uvicorn app.main:app`
app = create_app()
