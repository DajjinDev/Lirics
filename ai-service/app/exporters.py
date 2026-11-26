"""Exportadores PUROS: Result → LRC / LRC enhanced / JSON (compatible con el modelo SyncedLyrics de Liriks)."""

from __future__ import annotations

import json

from .models import Result


def lrc_time(ms: int) -> str:
    """12_340 ms → '00:12.34'. Redondea a centésimas con acarreo correcto (59 995 ms → '01:00.00')."""
    cs_total = max(0, round(ms / 10))
    minutes, rest = divmod(cs_total, 6000)
    seconds, cs = divmod(rest, 100)
    return f"{minutes:02d}:{seconds:02d}.{cs:02d}"


def _clean(text: str) -> str:
    # Un salto de línea dentro de una línea rompería el formato.
    return " ".join(text.split())


def to_lrc(result: Result, *, enhanced: bool = False, title: str | None = None, artist: str | None = None) -> str:
    """LRC estándar (una marca por línea). `enhanced=True` añade <mm:ss.xx> antes de cada palabra."""
    out: list[str] = []
    if title:
        out.append(f"[ti:{_clean(title)}]")
    if artist:
        out.append(f"[ar:{_clean(artist)}]")
    out.append(f"[length:{lrc_time(result.duration_ms)[:5]}]")
    out.append("[re:Liriks AI]")
    if result.engine.demo:
        out.append("[by:DEMO - no es una sincronizacion real]")

    for line in result.lines:
        if enhanced and line.words:
            body = " ".join(f"<{lrc_time(w.start_ms)}>{_clean(w.text)}" for w in line.words)
            # La marca de cierre permite conocer el fin de la última palabra.
            body += f" <{lrc_time(line.words[-1].end_ms)}>"
        else:
            body = _clean(line.text)
        out.append(f"[{lrc_time(line.start_ms)}]{body}")
    return "\n".join(out) + "\n"


def to_json(result: Result, *, track_id: str = "ai", title: str | None = None, artist: str | None = None) -> str:
    """JSON compatible con `SyncedLyrics` del frontend (tiempos en ms) + metadatos del proceso.

    Las pausas instrumentales se incluyen como líneas `isBreak` para que el motor del reproductor
    las muestre sin recalcularlas.
    """
    items: list[tuple[int, dict]] = []
    for line in result.lines:
        items.append(
            (
                line.start_ms,
                {
                    "text": _clean(line.text),
                    "startTime": line.start_ms,
                    "endTime": line.end_ms,
                    "isBreak": False,
                    "words": [
                        {"text": _clean(w.text), "startTime": w.start_ms, "endTime": w.end_ms} for w in line.words
                    ],
                    "confidence": line.confidence,
                    "flags": line.flags,
                },
            )
        )
    for b in result.breaks:
        items.append(
            (b.start_ms, {"text": "", "startTime": b.start_ms, "endTime": b.end_ms, "isBreak": True})
        )
    items.sort(key=lambda p: p[0])
    lines = [{"id": f"l{i}", **body} for i, (_, body) in enumerate(items)]

    payload = {
        "format": "liriks-synced-lyrics",
        "version": 1,
        "trackId": track_id,
        "source": "liriks-ai" + ("-demo" if result.engine.demo else ""),
        "language": result.language,
        "synchronizationType": "word" if any(ln.words for ln in result.lines) else "line",
        "duration": result.duration_ms,
        "lines": lines,
        "meta": {
            "title": title,
            "artist": artist,
            "mode": result.mode,
            "overallConfidence": result.overall_confidence,
            "warnings": result.warnings,
            "engine": result.engine.model_dump(),
        },
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
