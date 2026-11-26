import { LyricLine, LyricWord } from '../models/lyrics.models';

/** Línea cruda: lo que cualquier formato de origen sabe decir de ella. */
export interface RawLine {
  start: number;
  /** Fin explícito si el formato lo trae (p. ej. lyricsfile). */
  end?: number;
  text: string;
  words?: { text: string; start: number; end?: number }[];
  /** Instante en que terminó el canto según una marca vacía posterior (LRC). */
  endHint?: number;
}

/** Hueco implícito mínimo (sin marca vacía) para considerarlo pausa instrumental. */
export const IMPLICIT_BREAK_MIN_MS = 7000;
/** Hueco mínimo cuando el propio archivo marca explícitamente el silencio. */
export const EXPLICIT_BREAK_MIN_MS = 3500;
/** Intro mínima antes de la primera línea para mostrar el indicador. */
export const INTRO_BREAK_MIN_MS = 4000;

/** Duración estimada de una línea cantada cuando el formato no trae su final. */
export function estimateLineDurationMs(text: string): number {
  const ms = 1200 + text.trim().length * 80;
  return Math.min(7000, Math.max(1800, ms));
}

/**
 * Convierte líneas crudas en `LyricLine[]` ordenadas y consistentes:
 * calcula finales, reparte los tiempos de palabras e inserta pausas
 * instrumentales (`isBreak`) donde los tiempos reales dejan un hueco.
 */
export function buildLines(raw: RawLine[], durationMs?: number): LyricLine[] {
  const sorted = raw
    .filter((r) => Number.isFinite(r.start) && r.start >= 0)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.start - b.r.start || a.i - b.i)
    .map((x) => x.r);

  // 1) Separar marcas vacías (silencio) de líneas cantadas.
  type Sung = RawLine & { text: string };
  const sung: Sung[] = [];
  for (const line of sorted) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (text === '') {
      const prev = sung[sung.length - 1];
      if (prev && prev.endHint === undefined && line.start > prev.start) {
        prev.endHint = line.start;
      }
      continue;
    }
    sung.push({ ...line, text });
  }

  const out: LyricLine[] = [];
  let id = 0;
  const pushBreak = (start: number, end: number) => {
    out.push({ id: `l${id++}`, text: '', startTime: start, endTime: end, isBreak: true });
  };

  if (sung.length > 0 && sung[0].start >= INTRO_BREAK_MIN_MS) {
    pushBreak(0, sung[0].start);
  }

  for (let i = 0; i < sung.length; i++) {
    const cur = sung[i];
    const nextStart = sung[i + 1]?.start;
    const estimated = cur.start + estimateLineDurationMs(cur.text);

    let end: number;
    let explicit = false;
    if (cur.end !== undefined && cur.end > cur.start) {
      end = cur.end;
      explicit = true;
    } else if (cur.endHint !== undefined) {
      end = cur.endHint;
      explicit = true;
    } else {
      end = estimated;
    }
    if (nextStart !== undefined) end = Math.min(end, nextStart);
    else if (durationMs && durationMs > cur.start) end = Math.min(end, durationMs);
    if (end <= cur.start) end = cur.start + 1;

    out.push({
      id: `l${id++}`,
      text: cur.text,
      startTime: cur.start,
      endTime: end,
      isBreak: false,
      // Estimado cuando el formato no dio el fin (ni explícito ni por una marca vacía posterior).
      endInferred: !explicit,
      words: buildWords(cur, end),
    });

    if (nextStart !== undefined) {
      const gap = nextStart - end;
      const min = explicit ? EXPLICIT_BREAK_MIN_MS : IMPLICIT_BREAK_MIN_MS;
      if (gap >= min) pushBreak(end, nextStart);
    }
  }
  return out;
}

function buildWords(line: RawLine, lineEnd: number): LyricWord[] | undefined {
  if (!line.words || line.words.length === 0) return undefined;
  const words = line.words
    .filter((w) => w.text.trim() !== '' && Number.isFinite(w.start))
    .sort((a, b) => a.start - b.start);
  if (words.length === 0) return undefined;
  return words.map((w, i) => {
    const next = words[i + 1]?.start;
    let end = w.end !== undefined && w.end > w.start ? w.end : (next ?? lineEnd);
    if (next !== undefined) end = Math.min(end, next);
    if (end <= w.start) end = Math.max(w.start + 1, lineEnd);
    return { text: w.text, startTime: w.start, endTime: end };
  });
}

/**
 * Sincronización progresiva aproximada (nivel 4): reparte el tiempo de una
 * línea entre sus palabras según su longitud. NO es sincronía vocal real;
 * la interfaz debe indicarlo como "aproximada".
 */
export function approximateWords(line: LyricLine): LyricWord[] {
  if (line.isBreak) return [];
  const parts = line.text.match(/\S+\s*/g) ?? [];
  if (parts.length === 0) return [];
  const weights = parts.map((p) => Math.max(2, p.trim().length));
  const total = weights.reduce((a, b) => a + b, 0);
  // La voz suele terminar un poco antes del final estimado de la línea.
  const span = Math.max(1, (line.endTime - line.startTime) * 0.92);
  let cursor = line.startTime;
  return parts.map((text, i) => {
    const dur = (weights[i] / total) * span;
    const w: LyricWord = { text, startTime: cursor, endTime: cursor + dur };
    cursor += dur;
    return w;
  });
}
