import { parse as parseYaml } from 'yaml';
import { SyncedLyrics } from '../models/lyrics.models';
import { buildLines, RawLine } from './lyrics-builder';

interface YamlWord {
  text?: unknown;
  start_ms?: unknown;
  end_ms?: unknown;
}
interface YamlLine {
  text?: unknown;
  start_ms?: unknown;
  end_ms?: unknown;
  words?: YamlWord[];
}
interface YamlDoc {
  metadata?: { duration_ms?: unknown; language?: unknown; instrumental?: unknown };
  lines?: YamlLine[];
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Interpreta el "lyricsfile" (YAML) que LRCLIB devuelve cuando existe
 * sincronización por palabra (`hasWordSync: true`). Devuelve `null` si el
 * contenido no es válido para que el llamador use el LRC por líneas.
 */
export function lyricsfileToSyncedLyrics(
  source: string,
  opts: { trackId: string; sourceName: string; durationMs?: number },
): SyncedLyrics | null {
  let doc: YamlDoc;
  try {
    doc = parseYaml(source) as YamlDoc;
  } catch {
    return null;
  }
  if (!doc || !Array.isArray(doc.lines)) return null;

  const raw: RawLine[] = [];
  for (const l of doc.lines) {
    const start = num(l.start_ms);
    if (start === undefined || typeof l.text !== 'string') continue;
    const words = Array.isArray(l.words)
      ? l.words.flatMap((w) => {
          const ws = num(w.start_ms);
          return ws !== undefined && typeof w.text === 'string'
            ? [{ text: w.text, start: ws, end: num(w.end_ms) }]
            : [];
        })
      : undefined;
    raw.push({ start, end: num(l.end_ms), text: l.text, words });
  }

  const duration = num(doc.metadata?.duration_ms) ?? opts.durationMs;
  const lines = buildLines(raw, duration);
  const singable = lines.filter((l) => !l.isBreak);
  if (singable.length === 0) return null;

  const withWords = singable.filter((l) => l.words && l.words.length > 0).length;
  return {
    trackId: opts.trackId,
    language: typeof doc.metadata?.language === 'string' ? doc.metadata.language : undefined,
    source: opts.sourceName,
    synchronizationType: withWords / singable.length >= 0.5 ? 'word' : 'line',
    duration: duration ?? 0,
    lines,
  };
}
