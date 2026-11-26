"""Postproceso PURO: de palabras crudas del motor a líneas sincronizadas con confianza.

Nada aquí depende de modelos, GPU ni archivos, así que se prueba con datos sintéticos.
Los indicadores de confianza son MEDIBLES (puntuación del alineador, tiempos interpolados,
velocidad silábica, solapamiento con silencio); no se simula "entender" la canción.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .alignment_text import MappedLine, norm
from .backends.base import RawWord
from .models import Break, Line, Word

MIN_WORD_MS = 20
# Pesos de confianza para palabras sin puntuación propia
_INTERPOLATED_CONF = 0.2
_UNSCORED_CONF = 0.6
LOW_CONFIDENCE = 0.5
FAST_WORDS_PER_S = 7.0
SILENCE_OVERLAP_FLAG = 0.6
_SENTENCE_END = re.compile(r"[.!?…]$")


@dataclass
class _W:
    text: str
    start: float | None  # ms
    end: float | None  # ms
    score: float | None
    interpolated: bool = False


# --------------------------------------------------------------------------- palabras


def _to_ms(words: list[RawWord]) -> list[_W]:
    out: list[_W] = []
    for w in words:
        text = (w.text or "").strip()
        if not text:
            continue
        has_time = w.start is not None and w.end is not None
        out.append(
            _W(text, w.start * 1000 if has_time else None, w.end * 1000 if has_time else None, w.score)  # type: ignore[operator]
        )
    return out


def _interpolate_missing(ws: list[_W], duration_ms: float) -> None:
    """Reparte el tiempo de las palabras sin marca entre sus vecinas con tiempo (por nº de letras)."""
    i, n = 0, len(ws)
    while i < n:
        if ws[i].start is not None:
            i += 1
            continue
        j = i
        while j < n and ws[j].start is None:
            j += 1
        left = ws[i - 1].end if i > 0 and ws[i - 1].end is not None else 0.0
        right = ws[j].start if j < n and ws[j].start is not None else duration_ms
        left = left or 0.0
        right = max(right or 0.0, left)
        weights = [max(1, len(w.text)) for w in ws[i:j]]
        total = sum(weights)
        cursor = left
        for w, wt in zip(ws[i:j], weights):
            span = (right - left) * wt / total
            w.start, w.end, w.interpolated, w.score = cursor, cursor + span, True, None
            cursor += span
        i = j


def _enforce_monotonic(ws: list[_W], duration_ms: float) -> None:
    prev_end = 0.0
    for w in ws:
        assert w.start is not None and w.end is not None
        w.start = min(max(w.start, 0.0), duration_ms)
        w.end = min(max(w.end, w.start + MIN_WORD_MS), duration_ms) if w.start + MIN_WORD_MS <= duration_ms else duration_ms
        if w.start < prev_end:
            w.start = prev_end
            if w.end <= w.start:
                w.end = min(w.start + MIN_WORD_MS, duration_ms)
        prev_end = w.end


def finalize_words(raw: list[RawWord], duration_ms: int) -> list[Word]:
    """Palabras crudas → palabras con tiempos completos, ordenados y dentro del audio (en ms)."""
    ws = _to_ms(raw)
    if not ws:
        return []
    _interpolate_missing(ws, float(duration_ms))
    _enforce_monotonic(ws, float(duration_ms))
    return [
        Word(
            text=w.text,
            start_ms=round(w.start or 0),
            end_ms=max(round(w.end or 0), round(w.start or 0) + 1),
            score=None if w.interpolated or w.score is None else round(min(1.0, max(0.0, w.score)), 3),
            interpolated=w.interpolated,
        )
        for w in ws
    ]


# --------------------------------------------------------------------------- líneas


def _word_conf(w: Word) -> float:
    if w.interpolated:
        return _INTERPOLATED_CONF
    return _UNSCORED_CONF if w.score is None else w.score


def line_confidence(words: list[Word]) -> float:
    if not words:
        return 0.0
    return round(sum(_word_conf(w) for w in words) / len(words), 3)


def _make_line(idx: int, text: str, words: list[Word]) -> Line:
    start, end = words[0].start_ms, words[-1].end_ms
    flags: list[str] = []
    conf = line_confidence(words)
    if conf < LOW_CONFIDENCE:
        flags.append("low_confidence")
    if any(w.interpolated for w in words):
        flags.append("interpolated_words")
    span_s = max(0.001, (end - start) / 1000)
    if len(words) >= 4 and len(words) / span_s > FAST_WORDS_PER_S:
        flags.append("fast_speech")
    return Line(id=f"a{idx}", text=text, start_ms=start, end_ms=end, words=words, confidence=conf, flags=flags)


def group_into_lines(
    words: list[Word],
    segment_starts: set[int] | None = None,
    *,
    max_chars: int = 42,
    max_gap_ms: int = 900,
) -> list[Line]:
    """Agrupa palabras transcritas en líneas legibles (pausas, longitud y puntuación)."""
    segment_starts = segment_starts or set()
    lines: list[Line] = []
    cur: list[Word] = []
    chars = 0

    def flush() -> None:
        nonlocal cur, chars
        if cur:
            lines.append(_make_line(len(lines), " ".join(w.text for w in cur), cur))
        cur, chars = [], 0

    for i, w in enumerate(words):
        if cur:
            gap = w.start_ms - cur[-1].end_ms
            long_enough = chars >= 12
            if (
                gap >= max_gap_ms
                or chars + 1 + len(w.text) > max_chars
                or (i in segment_starts and long_enough)
                or (long_enough and _SENTENCE_END.search(cur[-1].text))
            ):
                flush()
        cur.append(w)
        chars += len(w.text) + (1 if len(cur) > 1 else 0)
    flush()
    return lines


def lines_from_mapped(mapped: list[MappedLine], duration_ms: int) -> list[Line]:
    """Letra aportada: se conserva el texto y el reparto en líneas del usuario."""
    lines: list[Line] = []
    for m in mapped:
        words = finalize_words(m.words, duration_ms) if m.words else []
        if not words:
            continue
        lines.append(_make_line(len(lines), m.text, words))
    return _fix_cross_line_overlaps(lines)


def _fix_cross_line_overlaps(lines: list[Line]) -> list[Line]:
    """finalize_words trabaja por línea: aquí se garantiza el orden entre líneas consecutivas."""
    prev_end = 0
    for line in lines:
        for w in line.words:
            if w.start_ms < prev_end:
                w.start_ms = prev_end
                w.end_ms = max(w.end_ms, w.start_ms + 1)
            prev_end = w.end_ms
        line.start_ms, line.end_ms = line.words[0].start_ms, line.words[-1].end_ms
    return lines


# --------------------------------------------------------------------------- silencios y pausas


def apply_silences(lines: list[Line], silences: list[tuple[int, int]]) -> int:
    """Marca (y penaliza) líneas que caen sobre silencio MEDIDO del audio. Devuelve cuántas."""
    flagged = 0
    for line in lines:
        span = max(1, line.end_ms - line.start_ms)
        overlap = sum(max(0, min(line.end_ms, b) - max(line.start_ms, a)) for a, b in silences)
        if overlap / span >= SILENCE_OVERLAP_FLAG:
            line.flags.append("in_silence")
            line.confidence = round(line.confidence * 0.6, 3)
            if "low_confidence" not in line.flags and line.confidence < LOW_CONFIDENCE:
                line.flags.append("low_confidence")
            flagged += 1
    return flagged


def flag_repetitions(lines: list[Line], run: int = 3) -> int:
    """Marca 3+ líneas idénticas seguidas (síntoma típico de alucinación en tramos sin voz)."""
    flagged = 0
    i = 0
    while i < len(lines):
        j = i
        while j + 1 < len(lines) and norm(lines[j + 1].text) == norm(lines[i].text) and norm(lines[i].text):
            j += 1
        if j - i + 1 >= run:
            for k in range(i, j + 1):
                lines[k].flags.append("repetition")
            flagged += j - i + 1
        i = j + 1
    return flagged


def breaks_from_silences(silences: list[tuple[int, int]], min_ms: int = 3000) -> list[Break]:
    return [Break(start_ms=a, end_ms=b) for a, b in silences if b - a >= min_ms]


def breaks_from_lines(lines: list[Line], duration_ms: int, min_ms: int = 4000) -> list[Break]:
    """Plan B sin análisis de energía: huecos grandes entre líneas (incluye la intro)."""
    out: list[Break] = []
    prev_end = 0
    for line in lines:
        if line.start_ms - prev_end >= min_ms:
            out.append(Break(start_ms=prev_end, end_ms=line.start_ms))
        prev_end = max(prev_end, line.end_ms)
    return out


def overall_confidence(lines: list[Line]) -> float:
    total = sum(max(1, ln.end_ms - ln.start_ms) for ln in lines)
    if not lines or total == 0:
        return 0.0
    return round(sum(ln.confidence * max(1, ln.end_ms - ln.start_ms) for ln in lines) / total, 3)
