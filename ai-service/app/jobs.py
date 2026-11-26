"""Gestor de trabajos: cola de 1 trabajador (la GPU es un recurso compartido), progreso, cancelación
y limpieza. El audio de cada trabajo se elimina al terminar; los resultados caducan tras `job_ttl_s`."""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from .audio import AudioError
from .backends.base import Backend, BackendError, JobCancelled
from .config import Settings
from .models import JobState, JobStatus, Result, Stage
from .pipeline import Options, run_pipeline

log = logging.getLogger("liriks.ai")


class Job:
    def __init__(self, job_id: str, work_dir: Path, options: Options):
        self.id = job_id
        self.dir = work_dir
        self.options = options
        self.state: JobState = "queued"
        self.stage: Stage = "queued"
        self.progress = 0.0
        self.message = "En cola…"
        self.error: str | None = None
        self.result: Result | None = None
        self.finished_at: float | None = None
        self.cancel = threading.Event()


class JobManager:
    def __init__(self, settings: Settings, backend_provider: Callable[[], Backend]):
        self.settings = settings
        self._backend_provider = backend_provider
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="liriks-ai")
        settings.work_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ API pública

    def new_job_dir(self) -> tuple[str, Path]:
        job_id = uuid.uuid4().hex
        d = self.settings.work_dir / job_id
        d.mkdir(parents=True, exist_ok=False)
        return job_id, d

    def submit(self, job_id: str, work_dir: Path, upload: Path, options: Options) -> None:
        self.cleanup()
        job = Job(job_id, work_dir, options)
        with self._lock:
            self._jobs[job_id] = job
        self._executor.submit(self._run, job, upload)

    def status(self, job_id: str) -> JobStatus | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            return JobStatus(
                id=job.id, state=job.state, stage=job.stage, progress=round(job.progress, 3),
                message=job.message, error=job.error, result=job.result if job.state == "done" else None,
            )

    def job(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel_or_delete(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            if job.state in ("queued", "running"):
                job.cancel.set()  # el trabajador lo detiene en el siguiente punto de control
                return True
            del self._jobs[job_id]
            return True

    def cleanup(self) -> None:
        """Elimina resultados caducados y directorios huérfanos."""
        now = time.time()
        with self._lock:
            expired = [
                jid for jid, j in self._jobs.items()
                if j.finished_at is not None and now - j.finished_at > self.settings.job_ttl_s
            ]
            for jid in expired:
                del self._jobs[jid]
            live = set(self._jobs)
        try:
            for d in self.settings.work_dir.iterdir():
                if d.is_dir() and d.name not in live and now - d.stat().st_mtime > self.settings.job_ttl_s:
                    shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    # ------------------------------------------------------------------ ejecución

    def _update(self, job: Job, stage: Stage, progress: float, message: str) -> None:
        with self._lock:
            job.stage, job.progress, job.message = stage, max(job.progress, progress), message

    def _run(self, job: Job, upload: Path) -> None:
        if job.cancel.is_set():
            self._finish(job, "cancelled", "Cancelado.")
            return
        with self._lock:
            job.state = "running"
            job.stage, job.message = "validating", "Empezando…"
        try:
            backend = self._backend_provider()
            result = run_pipeline(
                upload, job.dir, job.options, backend, self.settings,
                report=lambda st, p, m: self._update(job, st, p, m),
                is_cancelled=job.cancel.is_set,
            )
            with self._lock:
                job.result = result
            self._finish(job, "done", "Listo")
        except JobCancelled:
            self._finish(job, "cancelled", "Cancelado.")
        except (AudioError, BackendError) as e:
            self._finish(job, "error", e.message)
        except Exception:  # noqa: BLE001
            log.exception("Fallo inesperado en el trabajo %s", job.id)
            # No se expone el detalle interno al cliente.
            self._finish(job, "error", "Ocurrió un error interno al procesar el audio.")
        finally:
            # Privacidad: el audio (y los stems) no se conservan nunca.
            shutil.rmtree(job.dir, ignore_errors=True)

    def _finish(self, job: Job, state: JobState, message: str) -> None:
        with self._lock:
            job.state = state
            job.message = message
            job.error = message if state == "error" else None
            if state == "done":
                job.stage, job.progress = "done", 1.0
            job.finished_at = time.time()
