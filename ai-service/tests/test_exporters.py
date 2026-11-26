import json
import re

from app.exporters import lrc_time, to_json, to_lrc
from app.models import Break, Engine, Line, Result, Word


def result(demo=False):
    return Result(
        language="es",
        duration_ms=65_000,
        mode="transcribed",
        engine=Engine(backend="fake" if demo else "whisperx", demo=demo),
        lines=[
            Line(
                id="a0", text="hola   mundo", start_ms=12_340, end_ms=14_000, confidence=0.9,
                words=[Word(text="hola", start_ms=12_340, end_ms=13_000), Word(text="mundo", start_ms=13_100, end_ms=14_000)],
            ),
            Line(id="a1", text="otra\nlinea", start_ms=30_000, end_ms=32_000, confidence=0.4, flags=["low_confidence"]),
        ],
        breaks=[Break(start_ms=0, end_ms=12_000)],
        overall_confidence=0.7,
        warnings=["w"],
    )


class TestLrcTime:
    def test_formato_basico(self):
        assert lrc_time(12_340) == "00:12.34"
        assert lrc_time(0) == "00:00.00"
        assert lrc_time(83_450) == "01:23.45"

    def test_acarreo_al_redondear_centesimas(self):
        assert lrc_time(59_996) == "01:00.00"
        assert lrc_time(119_999) == "02:00.00"

    def test_negativos_se_acotan(self):
        assert lrc_time(-50) == "00:00.00"


class TestLrc:
    def test_estandar_una_marca_por_linea_con_metadatos(self):
        out = to_lrc(result(), title="T", artist="A")
        assert "[ti:T]" in out and "[ar:A]" in out and "[length:01:05]" in out
        assert "[00:12.34]hola mundo" in out
        assert "[00:30.00]otra linea" in out  # los saltos de línea internos no rompen el formato

    def test_enhanced_marca_cada_palabra_y_el_cierre(self):
        out = to_lrc(result(), enhanced=True)
        assert "[00:12.34]<00:12.34>hola <00:13.10>mundo <00:14.00>" in out
        # una línea sin palabras cae al texto plano
        assert "[00:30.00]otra linea" in out

    def test_el_resultado_de_demostracion_se_rotula(self):
        assert "DEMO" in to_lrc(result(demo=True))
        assert "DEMO" not in to_lrc(result(demo=False))

    def test_el_parser_del_frontend_puede_leerlo(self):
        """El formato debe cumplir lo que espera lrc-parser.ts: [mm:ss.xx] al inicio de línea."""
        out = to_lrc(result())
        stamped = [ln for ln in out.splitlines() if re.match(r"^\[\d{2}:\d{2}\.\d{2}\]", ln)]
        assert len(stamped) == 2


class TestJson:
    def test_estructura_compatible_con_syncedlyrics(self):
        data = json.loads(to_json(result(), track_id="job1", title="T", artist="A"))
        assert data["format"] == "liriks-synced-lyrics"
        assert data["trackId"] == "job1" and data["duration"] == 65_000
        assert data["synchronizationType"] == "word"
        first = data["lines"][0]
        # la pausa inicial va primero y tiene forma de línea isBreak
        assert first["isBreak"] is True and first["text"] == "" and (first["startTime"], first["endTime"]) == (0, 12_000)
        sung = data["lines"][1]
        assert sung["words"][0] == {"text": "hola", "startTime": 12_340, "endTime": 13_000}
        assert [ln["id"] for ln in data["lines"]] == ["l0", "l1", "l2"]

    def test_lineas_ordenadas_por_inicio(self):
        data = json.loads(to_json(result()))
        starts = [ln["startTime"] for ln in data["lines"]]
        assert starts == sorted(starts)

    def test_metadatos_y_modo_demo(self):
        data = json.loads(to_json(result(demo=True)))
        assert data["source"] == "liriks-ai-demo"
        assert data["meta"]["engine"]["demo"] is True
        assert data["meta"]["warnings"] == ["w"]

    def test_el_texto_se_normaliza_igual_que_en_el_lrc(self):
        data = json.loads(to_json(result()))
        texts = [ln["text"] for ln in data["lines"] if not ln["isBreak"]]
        assert texts == ["hola mundo", "otra linea"]

    def test_unicode_se_conserva(self):
        r = result()
        r.lines[0].text = "canción ñandú"
        assert "canción ñandú" in to_json(r)
