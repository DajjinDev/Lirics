from app.alignment_text import map_words_to_lines, norm, parse_lyrics_text, tokenize, transfer_timestamps
from app.backends.base import RawWord


def rw(text, s=None, e=None, score=0.9):
    return RawWord(text, s, e, score)


class TestParse:
    def test_limpia_lineas_y_espacios(self):
        assert parse_lyrics_text("  Hola   mundo \n\n\nsegunda línea\r\ntercera") == ["Hola mundo", "segunda línea", "tercera"]

    def test_descarta_etiquetas_de_seccion_pero_no_letra_entre_parentesis(self):
        txt = "[Chorus]\nla la la\n(Verso 1)\n(oh oh)\n[Intro: guitarra]\nfin"
        assert parse_lyrics_text(txt) == ["la la la", "(oh oh)", "fin"]

    def test_texto_vacio(self):
        assert parse_lyrics_text("  \n \n") == []


class TestNorm:
    def test_quita_acentos_mayusculas_y_signos(self):
        assert norm("¡Canción!") == "cancion"
        assert norm("don't") == "dont"

    def test_tokenize_ignora_espacios_vacios(self):
        assert tokenize("a  b ") == ["a", "b"]


class TestMapWordsToLines:
    def test_reparto_exacto_por_conteo(self):
        lines = ["hola mundo", "adios"]
        aligned = [rw("hola", 0, 1), rw("mundo", 1, 2), rw("adios", 3, 4)]
        out = map_words_to_lines(lines, aligned)
        assert [len(m.words) for m in out] == [2, 1]
        assert out[1].words[0].start == 3

    def test_si_el_motor_omitio_una_palabra_se_conservan_todas_las_de_la_letra(self):
        lines = ["uno dos tres", "cuatro cinco"]
        aligned = [rw("uno", 0, 1), rw("tres", 2, 3), rw("cuatro", 4, 5), rw("cinco", 5, 6)]  # falta "dos"
        out = map_words_to_lines(lines, aligned)
        assert [w.text for w in out[0].words] == ["uno", "dos", "tres"]
        assert out[0].words[1].start is None  # sin tiempo: el postproceso la interpola
        assert out[1].words[0].start == 4

    def test_palabra_dividida_por_el_motor(self):
        lines = ["hola mundo"]
        out = map_words_to_lines(lines, [rw("hola", 0, 1), rw("mun", 1, 1.5), rw("do", 1.5, 2)])
        assert [w.text for w in out[0].words] == ["hola", "mundo"]
        assert out[0].words[0].start == 0

    def test_lista_vacia_de_palabras_no_falla(self):
        out = map_words_to_lines(["a b"], [])
        assert [w.start for w in out[0].words] == [None, None]


class TestTransfer:
    def test_copia_tiempos_donde_coincide_el_texto(self):
        res = transfer_timestamps(["Hola", "mundo,", "feliz"], [rw("hola", 1, 2, 0.8), rw("mundo", 2, 3, 0.7), rw("feliz", 3, 4)])
        assert [(w.start, w.end) for w in res] == [(1, 2), (2, 3), (3, 4)]
        assert [w.text for w in res] == ["Hola", "mundo,", "feliz"]  # conserva el texto del usuario

    def test_palabras_sin_pareja_quedan_sin_tiempo(self):
        res = transfer_timestamps(["a", "b", "c"], [rw("a", 0, 1), rw("c", 4, 5)])
        assert res[1].start is None and res[2].start == 4
