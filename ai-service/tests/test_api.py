import json
import time

import pytest
from fastapi.testclient import TestClient

from app.backends.fake import FakeBackend
from app.config import Settings
from app.main import create_app
from tests.conftest import needs_ffmpeg

pytestmark = needs_ffmpeg

ORIGIN = "http://localhost:4200"


@pytest.fixture()
def client(tmp_path):
    settings = Settings(work_dir=tmp_path / "work", max_upload_mb=1, max_duration_s=120, job_ttl_s=60)
    app = create_app(settings, backend=FakeBackend())
    with TestClient(app) as c:
        c.work_dir = settings.work_dir  # type: ignore[attr-defined]
        yield c


def _upload(client, wav, *, rights="true", **extra):
    data = {"rights_confirmed": rights, **extra}
    with open(wav, "rb") as f:
        return client.post("/jobs", files={"audio": ("../../cancion mía.wav", f, "audio/wav")}, data=data)


def _wait(client, job_id, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        st = client.get(f"/jobs/{job_id}").json()
        if st["state"] in ("done", "error", "cancelled"):
            return st
        time.sleep(0.05)
    raise AssertionError("el trabajo no terminó a tiempo")


def test_health(client):
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["backend"] == "fake" and h["ffmpeg"] is True
    assert h["limits"]["max_upload_mb"] == 1


def test_flujo_completo_y_exportacion(client, short_wav):
    r = _upload(client, short_wav, title="Mi canción", artist="Yo")
    assert r.status_code == 202
    job_id = r.json()["id"]
    st = _wait(client, job_id)
    assert st["state"] == "done" and st["progress"] == 1.0
    assert st["result"]["engine"]["demo"] is True and st["result"]["lines"]

    lrc = client.get(f"/jobs/{job_id}/export", params={"format": "lrc"})
    assert lrc.status_code == 200 and "[ti:Mi canción]" in lrc.text and "DEMO" in lrc.text
    assert 'filename="lyrics.lrc"' in lrc.headers["content-disposition"]

    enhanced = client.get(f"/jobs/{job_id}/export", params={"format": "lrc-enhanced"})
    assert "<00:" in enhanced.text

    js = client.get(f"/jobs/{job_id}/export", params={"format": "json"})
    data = json.loads(js.text)
    assert data["format"] == "liriks-synced-lyrics" and data["lines"]


def test_exige_confirmar_los_derechos_sobre_el_audio(client, short_wav):
    assert _upload(client, short_wav, rights="false").status_code == 400
    with open(short_wav, "rb") as f:
        r = client.post("/jobs", files={"audio": ("a.wav", f, "audio/wav")})  # sin el campo
    assert r.status_code == 400


def test_archivo_que_no_es_audio_se_rechaza_con_422(client, tmp_path):
    bad = tmp_path / "x.mp3"
    bad.write_bytes(b"texto disfrazado de mp3" * 100)
    r = _upload(client, bad)
    assert r.status_code == 422
    assert not any(client.work_dir.iterdir())  # no queda nada en disco


def test_archivo_demasiado_grande_413(client, tmp_path):
    big = tmp_path / "big.wav"
    big.write_bytes(b"\0" * (2 * 1024 * 1024))
    assert _upload(client, big).status_code == 413
    assert not any(client.work_dir.iterdir())


def test_validaciones_de_campos(client, short_wav):
    assert _upload(client, short_wav, model_size="gigante").status_code == 422
    assert _upload(client, short_wav, language="../etc").status_code == 422
    assert _upload(client, short_wav, lyrics_text="x" * 50_000).status_code == 413


def test_el_nombre_del_cliente_no_toca_el_sistema_de_archivos(client, short_wav, tmp_path):
    job_id = _upload(client, short_wav).json()["id"]
    _wait(client, job_id)
    assert not (tmp_path.parent / "cancion mía.wav").exists()


def test_el_audio_no_se_conserva_tras_procesar(client, short_wav):
    job_id = _upload(client, short_wav).json()["id"]
    _wait(client, job_id)
    time.sleep(0.2)
    leftovers = [p for p in client.work_dir.rglob("*") if p.is_file()]
    assert leftovers == []


def test_ids_invalidos_y_desconocidos_dan_404(client):
    assert client.get("/jobs/no-es-un-id").status_code == 404
    assert client.get("/jobs/" + "0" * 32).status_code == 404
    assert client.get("/jobs/" + "0" * 32 + "/export").status_code == 404
    assert client.delete("/jobs/" + "0" * 32).status_code == 404


def test_exportar_formato_invalido_422(client, short_wav):
    job_id = _upload(client, short_wav).json()["id"]
    _wait(client, job_id)
    assert client.get(f"/jobs/{job_id}/export", params={"format": "exe"}).status_code == 422


def test_borrar_un_trabajo_terminado(client, short_wav):
    job_id = _upload(client, short_wav).json()["id"]
    _wait(client, job_id)
    assert client.delete(f"/jobs/{job_id}").status_code == 204
    assert client.get(f"/jobs/{job_id}").status_code == 404


def test_cors_solo_para_origenes_permitidos(client):
    ok = client.get("/health", headers={"Origin": ORIGIN})
    assert ok.headers.get("access-control-allow-origin") == ORIGIN
    bad = client.get("/health", headers={"Origin": "https://sitio-malicioso.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_el_servicio_no_acepta_urls_como_origen_de_audio(client):
    """No existe ningún parámetro para descargar audio de internet (política: nada de YouTube)."""
    r = client.post("/jobs", data={"rights_confirmed": "true", "url": "https://www.youtube.com/watch?v=x"})
    assert r.status_code == 422  # falta el archivo; la URL se ignora por completo
    schema = client.get("/openapi.json").json()
    props = schema["components"]["schemas"]["Body_create_job_jobs_post"]["properties"]
    assert not any("url" in k.lower() for k in props)
