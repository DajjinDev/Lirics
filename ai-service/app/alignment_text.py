"""Lógica PURA para trabajar con una letra aportada por el usuario.

- parse_lyrics_text: líneas limpias a partir de texto libre.
- map_words_to_lines: reparte las palabras alineadas entre las líneas originales.
- transfer_timestamps: plan B; copia tiempos de una transcripción a las palabras de la letra
  aportada usando una alineación texto-a-texto (difflib).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from .backends.base import RawWord

_SECTION_TAG = re.compile(r"^\s*[\[\(][^\]\)]{1,40}[\]\)]\s*$")
_ONLY_SECTION_WORD = re.compile(
    r"^\s*[\[\(]?\s*(verse|chorus|bridge|intro|outro|hook|pre-chorus|estribillo|verso|puente|coro)\b.*$", re.I
)


def parse_lyrics_text(text: str) -> list[str]:
    """Líneas no vacías; descarta etiquetas de sección tipo [Chorus] / (Verso 1)."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = " ".join(raw.split())
        if not line:
            continue
        if _SECTION_TAG.match(line) and _ONLY_SECTION_WORD.match(line):
            continue
        lines.append(line)
    return lines


def tokenize(line: str) -> list[str]:
    return [t for t in line.split(" ") if t.strip()]


def norm(token: str) -> str:
    """Forma comparable: sin acentos, minúsculas, solo letras/números."""
    t = unicodedata.normalize("NFD", token)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^\w]", "", t, flags=re.UNICODE)


@dataclass
class MappedLine:
    text: str
    words: list[RawWord]


def map_words_to_lines(lines: list[str], aligned: list[RawWord]) -> list[MappedLine]:
    """Asigna las palabras alineadas a cada línea de la letra aportada.

    Caso normal: el motor devuelve exactamente los mismos tokens (mismo orden) → reparto por
    conteo. Si difieren (p. ej. el motor omitió o dividió palabras) se empareja por texto.
    """
    per_line = [tokenize(line) for line in lines]
    total = sum(len(t) for t in per_line)

    if total == len(aligned) and all(
        norm(a.text) == norm(t) or not norm(t) for a, t in zip(aligned, [x for ts in per_line for x in ts])
    ):
        out: list[MappedLine] = []
        i = 0
        for line, toks in zip(lines, per_line):
            out.append(MappedLine(line, aligned[i : i + len(toks)]))
            i += len(toks)
        return out

    # Plan B: emparejar por texto y conservar siempre TODAS las palabras de la letra aportada.
    flat = [(li, t) for li, toks in enumerate(per_line) for t in toks]
    transferred = transfer_timestamps([t for _, t in flat], aligned)
    result = [MappedLine(line, []) for line in lines]
    for (li, _), w in zip(flat, transferred):
        result[li].words.append(w)
    return result


def transfer_timestamps(provided: list[str], hypothesis: list[RawWord]) -> list[RawWord]:
    """Copia tiempos de `hypothesis` a `provided` donde el texto coincide.

    Las palabras sin pareja quedan sin tiempo (start/end = None): el postproceso las interpola
    y las marca como `interpolated`.
    """
    a = [norm(t) for t in provided]
    b = [norm(w.text) for w in hypothesis]
    out = [RawWord(text=t, start=None, end=None, score=None) for t in provided]
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    for block in sm.get_matching_blocks():
        for k in range(block.size):
            src = hypothesis[block.b + k]
            dst = out[block.a + k]
            dst.start, dst.end, dst.score = src.start, src.end, src.score
    return out
