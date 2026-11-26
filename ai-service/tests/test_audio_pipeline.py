from pathlib import Path

import pytest

from app import audio
from app.backends.base import JobCancelled
from app.backends.fake import FakeBackend
from app.config import Settings
from app.pipeline import Options, run_pipeline
from tests.conftest import needs_ffmpeg

pytestmark = needs_ffmpeg


class TestProbe:
    def test_audio_valido(self, tone_silence_wav):
        info = audio.probe(tone_silence_wav, max_duration_s=60)
        assert 6_900 <= info.duration_ms <= 7_100
        assert info.channels == 1 and info.sample_rate == 16_000

    def test_un_archivo_que_no_es_audio_se_rechaza_por_contenido(self, tmp_path):
        fake = tmp_path / "musica.mp3"  # la extensión miente
        fake.write_bytes(b"esto no es un mp3, es texto" * 50)
        with pytest.raises(audio.AudioError) as e:
            audio.probe(fake, max_duration_s=60)
        assert e.value.code == "not_audio"

    def test_duracion_maxima(self, tone_silence_wav):
        with pytest.raises(audio.AudioError) as e:
            audio.probe(tone_silence_wav, max_duration_s=3)
        assert e.value.code == "too_long"

    def test_archivo_inexistente(self, tmp_path):
        with pytest.raises(audio.AudioError):
            audio.probe(tmp_path / "nada.wav", max_duration_s=60)


class TestSilence:
    def test_parser_de_silencedetect(self):
        err = "silence_start: 2.001\nsilence_end: 5.0 | silence_duration: 2.999\nsilence_start: 9.5\n"
        assert audio.parse_silencedetect(err, 12_000) == [(2001, 5000), (9500, 12_000)]

    def test_detecta_el_silencio_real_de_un_audio_sintetico(self, tone_silence_wav):
        spans = audio.detect_silences(tone_silence_wav, 7_000)
        assert len(spans) == 1
        start, end = spans[0]
        assert abs(start - 2000) < 250 and abs(end - 5000) < 250

    def test_un_tono_continuo_no_tiene_silencios(self, short_wav):
        assert audio.detect_silences(short_wav, 12_000) == []


class TestConvert:
    def test_convierte_a_wav_16k_mono(self, tone_silence_wav, tmp_path):
        out = audio.to_wav16k_mono(tone_silence_wav, tmp_path / "o.wav")
        info = audio.probe(out, max_duration_s=60)
        assert info.sample_rate == 16_000 and info.channels == 1


def _run(upload: Path, tmp_path, options: Options, cancelled=lambda: False):
    events: list = []
    settings = Settings(work_dir=tmp_path / "w", max_duration_s=120)
    res = run_pipeline(
        upload, tmp_path / "job", options, FakeBackend(), settings,
        report=lambda st, p, m: events.append((st, p)), is_cancelled=cancelled,
    )
    return res, events


class TestPipelineWithFakeBackend:
    def _copy(self, src: Path, tmp_path) -> Path:
        dst = tmp_path / "upload.bin"
        dst.write_bytes(src.read_bytes())
        return dst

    def test_transcripcion_produce_lineas_validas_y_rotula_la_demo(self, short_wav, tmp_path):
        up = self._copy(short_wav, tmp_path)
        res, events = _run(up, tmp_path, Options())
        assert res.mode == "transcribed" and res.engine.demo is True
        assert res.warnings[0].startswith("RESULTADO DE DEMOSTRACIÓN")
        assert res.lines and res.duration_ms >= 11_900
        prev_end = 0
        for line in res.lines:
            assert line.start_ms >= prev_end - 1
            for w in line.words:
                assert 0 <= w.start_ms < w.end_ms <= res.duration_ms + 1
            prev_end = line.end_ms
        assert 0 <= res.overall_confidence <= 1

    def test_el_audio_original_se_elimina_tras_convertirlo(self, short_wav, tmp_path):
        up = self._copy(short_wav, tmp_path)
        _run(up, tmp_path, Options())
        assert not up.exists()

    def test_progreso_monotono_y_termina_en_100(self, short_wav, tmp_path):
        up = self._copy(short_wav, tmp_path)
        _, events = _run(up, tmp_path, Options())
        values = [p for _, p in events]
        assert values == sorted(values) and values[-1] == 1.0
        assert {s for s, _ in events} >= {"validating", "preparing", "transcribing", "building", "done"}

    def test_letra_aportada_se_alinea_y_conserva_texto_y_lineas(self, short_wav, tmp_path):
        up = self._copy(short_wav, tmp_path)
        lyrics = "Primera línea de prueba\n[Chorus]\nSegunda línea\n(oh oh)"
        res, _ = _run(up, tmp_path, Options(lyrics_text=lyrics))
        assert res.mode == "aligned_provided"
        assert [ln.text for ln in res.lines] == ["Primera línea de prueba", "Segunda línea", "(oh oh)"]
        assert res.lines[0].words[0].text == "Primera"

    def test_separacion_simulada_se_avisa(self, short_wav, tmp_path):
        up = self._copy(short_wav, tmp_path)
        res, _ = _run(up, tmp_path, Options(separate_vocals=True))
        assert any("simulada" in w for w in res.warnings)

    def test_cancelacion_detiene_el_pipeline(self, short_wav, tmp_path):
        up = self._copy(short_wav, tmp_path)
        with pytest.raises(JobCancelled):
            _run(up, tmp_path, Options(), cancelled=lambda: True)

    def test_archivo_no_audio_falla_con_error_de_audio(self, tmp_path):
        bad = tmp_path / "x.bin"
        bad.write_bytes(b"no soy audio" * 100)
        with pytest.raises(audio.AudioError):
            _run(bad, tmp_path, Options())
