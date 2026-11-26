import { SyncedLyrics } from '../models/lyrics.models';
import { buildLines, RawLine } from './lyrics-builder';

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-zA-Z#]+):(.*)\]\s*$/;
/** Etiquetas "enhanced LRC" por palabra: <mm:ss.xx>. Se descartan. */
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

export interface ParsedLrc {
  lines: RawLine[];
  /** Metadatos [ar:], [ti:], [al:], [length:], etc. */
  meta: Record<string, string>;
  /** [offset:] en ms tal como viene en el archivo. */
  offsetMs: number;
  /** Cantidad de marcas descartadas por estar duplicadas. */
  duplicatesDropped: number;
}

/** "01:23.45" → ms. La fracción de 1/2/3 dígitos son décimas/centésimas/milésimas. */
export function timeTagToMs(min: string, sec: string, frac?: string): number {
  const f = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;
  return Number(min) * 60_000 + Number(sec) * 1000 + f;
}

/**
 * Interpreta texto LRC. Soporta varias marcas por línea
 * (`[00:10.00][01:20.00]texto`), metadatos y la etiqueta `[offset:]`
 * (positivo = las letras aparecen antes, según la convención LRC).
 */
export function parseLrc(source: string): ParsedLrc {
  const meta: Record<string, string> = {};
  const entries: { start: number; text: string; order: number }[] = [];
  let order = 0;

  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const firstTag = line.startsWith('[') ? line.slice(0, line.indexOf(']') + 1) : '';
    const metaMatch = META_TAG.exec(line);
    if (metaMatch && !/^\[\d/.test(firstTag)) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    const stamps: number[] = [];
    let lastIndex = 0;
    TIME_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(line)) !== null) {
      // Solo se aceptan marcas contiguas al inicio de la línea.
      if (m.index !== lastIndex) break;
      stamps.push(timeTagToMs(m[1], m[2], m[3]));
      lastIndex = TIME_TAG.lastIndex;
    }
    if (stamps.length === 0) continue; // texto sin marca: se ignora en modo sincronizado

    const text = line.slice(lastIndex).replace(WORD_TAG, '').trim();
    for (const start of stamps) entries.push({ start, text, order: order++ });
  }

  const offsetMs = Number.parseInt(meta['offset'] ?? '0', 10) || 0;

  // Orden estable por tiempo y eliminación de duplicados exactos (mismo tiempo y texto).
  entries.sort((a, b) => a.start - b.start || a.order - b.order);
  const seen = new Set<string>();
  const lines: RawLine[] = [];
  let duplicatesDropped = 0;
  for (const e of entries) {
    const key = `${e.start}|${e.text}`;
    if (seen.has(key)) {
      duplicatesDropped++;
      continue;
    }
    seen.add(key);
    lines.push({ start: Math.max(0, e.start - offsetMs), text: e.text });
  }
  return { lines, meta, offsetMs, duplicatesDropped };
}

/** LRC → `SyncedLyrics` listo para el motor. */
export function lrcToSyncedLyrics(
  source: string,
  opts: { trackId: string; sourceName: string; durationMs?: number; language?: string },
): SyncedLyrics {
  const parsed = parseLrc(source);
  const lines = buildLines(parsed.lines, opts.durationMs);
  return {
    trackId: opts.trackId,
    language: opts.language,
    source: opts.sourceName,
    synchronizationType: lines.some((l) => !l.isBreak) ? 'line' : 'none',
    duration: opts.durationMs ?? 0,
    lines,
  };
}
