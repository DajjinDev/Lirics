from app.backends.base import RawWord
from app.models import Line, Word
from app.postprocess import (
    apply_silences,
    breaks_from_lines,
    breaks_from_silences,
    finalize_words,
    flag_repetitions,
    group_into_lines,
    line_confidence,
    overall_confidence,
)


def rw(text, s, e, score=0.9):
    return RawWord(text, s, e, score)


class TestFinalizeWords:
    def test_convierte_segundos_a_ms_y_redondea(self):
        out = finalize_words([rw("hola", 1.2345, 1.8), rw("mundo", 2.0, 2.5)], 10_000)
        assert out[0].start_ms in (1234, 1235) and out[0].end_ms == 1800
        assert (out[1].start_ms, out[1].end_ms) == (2000, 2500)
        assert out[0].text == "hola"

    def test_interpola_palabras_sin_tiempo_y_las_marca(self):
        raw = [rw("uno", 1.0, 1.5), RawWord("dos", None, None), RawWord("tres", None, None), rw("cuatro", 3.0, 3.5)]
        out = finalize_words(raw, 10_000)
        assert [w.interpolated for w in out] == [False, True, True, False]
        # las interpoladas quedan entre sus vecinas, en orden, sin puntuación inventada
        assert out[0].end_ms <= out[1].start_ms < out[1].end_ms <= out[2].start_ms < out[2].end_ms <= out[3].start_ms
        assert out[1].score is None and out[2].score is None

    def test_interpola_al_inicio_y_al_final(self):
        raw = [RawWord("a", None, None), rw("b", 2.0, 2.4), RawWord("c", None, None)]
        out = finalize_words(raw, 5_000)
        assert out[0].start_ms >= 0 and out[0].end_ms <= 2000
        assert out[2].start_ms >= 2400 and out[2].end_ms <= 5000

    def test_corrige_solapes_y_deja_orden_monotono(self):
        out = finalize_words([rw("a", 1.0, 2.0), rw("b", 1.5, 2.5), rw("c", 2.4, 3.0)], 10_000)
        for prev, cur in zip(out, out[1:]):
            assert cur.start_ms >= prev.end_ms
        assert all(w.end_ms > w.start_ms for w in out)

    def test_no_se_sale_de_la_duracion_del_audio(self):
        out = finalize_words([rw("a", 9.5, 12.0), rw("b", 11.0, 13.0)], 10_000)
        assert all(0 <= w.start_ms and w.end_ms <= 10_000 + 1 for w in out)

    def test_descarta_palabras_vacias(self):
        out = finalize_words([rw(" ", 0, 1), rw("hola", 1, 2), rw("", 2, 3)], 5_000)
        assert [w.text for w in out] == ["hola"]

    def test_lista_vacia(self):
        assert finalize_words([], 1000) == []

    def test_puntuacion_se_acota_a_0_1(self):
        out = finalize_words([rw("a", 0, 1, score=1.7), rw("b", 1, 2, score=-0.3)], 5_000)
        assert out[0].score == 1.0 and out[1].score == 0.0


def W(text, s, e, score=0.9, interp=False):
    return Word(text=text, start_ms=s, end_ms=e, score=score, interpolated=interp)


class TestGroupIntoLines:
    def test_corta_por_pausa_larga(self):
        words = [W("hola", 0, 400), W("mundo", 450, 900), W("adios", 3000, 3400)]
        lines = group_into_lines(words)
        assert [ln.text for ln in lines] == ["hola mundo", "adios"]

    def test_corta_por_longitud_maxima(self):
        words = [W(f"palabra{i}", i * 500, i * 500 + 400) for i in range(12)]
        lines = group_into_lines(words, max_chars=30)
        assert len(lines) > 1
        assert all(len(ln.text) <= 30 for ln in lines)

    def test_corta_tras_fin_de_frase_si_la_linea_es_suficiente(self):
        words = [W("esto", 0, 300), W("es", 350, 500), W("una", 550, 700), W("frase.", 750, 1000), W("otra", 1050, 1300)]
        assert [ln.text for ln in group_into_lines(words)] == ["esto es una frase.", "otra"]

    def test_respeta_inicios_de_segmento_cuando_la_linea_ya_es_larga(self):
        words = [W("palabra", 0, 300), W("larga", 350, 600), W("nueva", 650, 900)]
        lines = group_into_lines(words, segment_starts={2})
        assert len(lines) == 2

    def test_inicio_y_fin_de_linea_salen_de_sus_palabras(self):
        lines = group_into_lines([W("a", 100, 200), W("b", 250, 400)])
        assert (lines[0].start_ms, lines[0].end_ms) == (100, 400)

    def test_sin_palabras(self):
        assert group_into_lines([]) == []


class TestConfidence:
    def test_media_de_puntuaciones(self):
        assert line_confidence([W("a", 0, 1, 0.8), W("b", 1, 2, 1.0)]) == 0.9

    def test_las_interpoladas_pesan_poco(self):
        c = line_confidence([W("a", 0, 1, 1.0), W("b", 1, 2, None, interp=True)])
        assert c < 0.7

    def test_sin_puntuacion_usa_un_valor_neutro_no_alto(self):
        assert 0.4 < line_confidence([W("a", 0, 1, None)]) < 0.8

    def test_banderas(self):
        lines = group_into_lines([W("a", 0, 100, 0.2), W("b", 120, 200, 0.2), W("c", 220, 300, 0.2), W("d", 320, 400, 0.2, True)])
        flags = lines[0].flags
        assert "low_confidence" in flags and "interpolated_words" in flags and "fast_speech" in flags

    def test_linea_buena_sin_banderas(self):
        lines = group_into_lines([W("hola", 0, 600, 0.95), W("mundo", 700, 1300, 0.95)])
        assert lines[0].flags == []

    def test_confianza_global_ponderada_por_duracion(self):
        a = Line(id="1", text="a", start_ms=0, end_ms=9000, confidence=1.0)
        b = Line(id="2", text="b", start_ms=9000, end_ms=10_000, confidence=0.0)
        assert overall_confidence([a, b]) == 0.9
        assert overall_confidence([]) == 0.0


class TestSilencesAndBreaks:
    def _line(self, s, e, conf=0.9):
        return Line(id="x", text="t", start_ms=s, end_ms=e, confidence=conf)

    def test_linea_sobre_silencio_medido_se_marca_y_penaliza(self):
        inside, outside = self._line(2500, 4500), self._line(0, 1500)
        n = apply_silences([inside, outside], [(2000, 5000)])
        assert n == 1
        assert "in_silence" in inside.flags and inside.confidence < 0.9
        assert "in_silence" not in outside.flags and outside.confidence == 0.9

    def test_solape_parcial_pequeno_no_marca(self):
        ln = self._line(0, 4000)
        assert apply_silences([ln], [(3500, 5000)]) == 0

    def test_repeticiones(self):
        lines = [Line(id=str(i), text="Gracias por ver", start_ms=i, end_ms=i + 1, confidence=0.5) for i in range(3)]
        lines.append(Line(id="z", text="otra", start_ms=9, end_ms=10, confidence=0.5))
        assert flag_repetitions(lines) == 3
        assert "repetition" in lines[0].flags and "repetition" not in lines[3].flags

    def test_dos_repeticiones_no_alcanzan(self):
        lines = [Line(id=str(i), text="igual", start_ms=i, end_ms=i + 1, confidence=0.5) for i in range(2)]
        assert flag_repetitions(lines) == 0

    def test_pausas_desde_silencios_filtra_las_cortas(self):
        b = breaks_from_silences([(0, 2000), (10_000, 15_000)])
        assert [(x.start_ms, x.end_ms) for x in b] == [(10_000, 15_000)]

    def test_pausas_desde_huecos_entre_lineas_incluye_la_intro(self):
        lines = [self._line(8000, 9000), self._line(9500, 10_000), self._line(20_000, 21_000)]
        b = breaks_from_lines(lines, 25_000)
        assert [(x.start_ms, x.end_ms) for x in b] == [(0, 8000), (10_000, 20_000)]
