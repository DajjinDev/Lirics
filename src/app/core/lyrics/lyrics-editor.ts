/**
 * Modelo y operaciones PURAS del editor de sincronización (Fase 3).
 *
 * Todas las operaciones devuelven un documento NUEVO (inmutable), así que el estado es
 * predecible, se puede deshacer y se prueba sin interfaz. Tiempos en milisegundos.
 */
import { LyricWord, SyncedLyrics } from '../models/lyrics.models';
import { buildLines, RawLine } from './lyrics-builder';
import { parseLrc } from './lrc-parser';

export interface StudioLine {
  id: string;
  text: string;
  /** null = línea todavía sin sincronizar (flujo manual / tap-sync). */
  startMs: number | null;
  endMs?: number;
  words?: LyricWord[];
  /** 0..1 si lo calculó el servicio de IA. */
  confidence?: number;
  flags?: string[];
}

export interface StudioDoc {
  lines: StudioLine[];
  durationMs: number;
  language?: string;
  source: 'ai' | 'ai-demo' | 'import' | 'manual';
  warnings: string[];
  overallConfidence?: number;
  /** Intervalos sin voz medidos sobre el audio (opcional). */
  breaks: { startMs: number; endMs: number }[];
}

const MIN_LINE_MS = 50;
let counter = 0;
const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

/* ------------------------------------------------------------------ importación */

/** Resultado del servicio de IA (snake_case, ver ai-service/app/models.py). */
export interface ServiceResult {
  language: string | null;
  duration_ms: number;
  mode: string;
  engine: { demo: boolean };
  lines: {
    id: string;
    text: string;
    start_ms: number;
    end_ms: number;
    confidence: number;
    flags: string[];
    words: { text: string; start_ms: number; end_ms: number }[];
  }[];
  breaks: { start_ms: number; end_ms: number }[];
  overall_confidence: number;
  warnings: string[];
}

export function fromServiceResult(r: ServiceResult): StudioDoc {
  return {
    lines: r.lines.map((l) => ({
      id: newId(),
      text: l.text,
      startMs: l.start_ms,
      endMs: l.end_ms,
      words: l.words.map((w) => ({ text: w.text, startTime: w.start_ms, endTime: w.end_ms })),
      confidence: l.confidence,
      flags: l.flags,
    })),
    durationMs: r.duration_ms,
    language: r.language ?? undefined,
    source: r.engine.demo ? 'ai-demo' : 'ai',
    warnings: r.warnings,
    overallConfidence: r.overall_confidence,
    breaks: r.breaks.map((b) => ({ startMs: b.start_ms, endMs: b.end_ms })),
  };
}

/** Texto libre → líneas SIN tiempo (para sincronizar a mano o enviar al alineador). */
export function fromPlainText(text: string, durationMs = 0): StudioDoc {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && !/^[[(]\s*(verse|chorus|bridge|intro|outro|hook|estribillo|verso|puente|coro)\b[^\])]*[\])]$/i.test(l));
  return {
    lines: lines.map((text) => ({ id: newId(), text, startMs: null })),
    durationMs,
    source: 'manual',
    warnings: [],
    breaks: [],
  };
}

export function fromLrcText(text: string, durationMs = 0): StudioDoc {
  const { lines: raw } = parseLrc(text);
  const lines: StudioLine[] = [];
  for (const r of raw) {
    if (r.text.trim() === '') continue; // las marcas vacías son pausas: las infiere buildLines
    lines.push({ id: newId(), text: r.text, startMs: r.start });
  }
  const last = raw[raw.length - 1];
  return {
    lines,
    durationMs: durationMs || (last ? last.start + 5000 : 0),
    source: 'import',
    warnings: [],
    breaks: [],
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** JSON exportado por Liriks (`format: "liriks-synced-lyrics"`). Valida estrictamente la forma. */
export function fromJsonText(text: string): StudioDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const d = data as Record<string, unknown>;
  if (!d || d['format'] !== 'liriks-synced-lyrics' || !Array.isArray(d['lines'])) {
    throw new Error('El archivo no tiene el formato «liriks-synced-lyrics».');
  }
  const lines: StudioLine[] = [];
  const breaks: StudioDoc['breaks'] = [];
  for (const raw of d['lines'] as Record<string, unknown>[]) {
    if (!raw || !isNum(raw['startTime']) || !isNum(raw['endTime'])) continue;
    if (raw['isBreak'] === true) {
      breaks.push({ startMs: raw['startTime'], endMs: raw['endTime'] });
      continue;
    }
    if (typeof raw['text'] !== 'string') continue;
    const lineText = raw['text'].replace(/s+/g, ' ').trim();
    if (lineText === '') continue;
    const words = Array.isArray(raw['words'])
      ? (raw['words'] as Record<string, unknown>[]).flatMap((w) =>
          typeof w['text'] === 'string' && isNum(w['startTime']) && isNum(w['endTime'])
            ? [{ text: w['text'], startTime: w['startTime'], endTime: w['endTime'] }]
            : [],
        )
      : undefined;
    lines.push({
      id: newId(),
      text: lineText,
      startMs: raw['startTime'],
      endMs: raw['endTime'],
      words: words && words.length ? words : undefined,
      confidence: isNum(raw['confidence']) ? raw['confidence'] : undefined,
      flags: Array.isArray(raw['flags']) ? (raw['flags'] as unknown[]).filter((f): f is string => typeof f === 'string') : undefined,
    });
  }
  const meta = (d['meta'] ?? {}) as Record<string, unknown>;
  return {
    lines,
    breaks,
    durationMs: isNum(d['duration']) ? d['duration'] : 0,
    language: typeof d['language'] === 'string' ? d['language'] : undefined,
    source: String(d['source'] ?? '').endsWith('-demo') ? 'ai-demo' : 'import',
    warnings: Array.isArray(meta['warnings']) ? (meta['warnings'] as unknown[]).filter((w): w is string => typeof w === 'string') : [],
    overallConfidence: isNum(meta['overallConfidence']) ? meta['overallConfidence'] : undefined,
  };
}

/* ------------------------------------------------------------------ edición (inmutable) */

const mapLine = (doc: StudioDoc, id: string, fn: (l: StudioLine) => StudioLine): StudioDoc => ({
  ...doc,
  lines: doc.lines.map((l) => (l.id === id ? fn(l) : l)),
});

const shiftLine = (l: StudioLine, delta: number): StudioLine => {
  if (l.startMs === null) return l;
  // Nunca se desplaza por debajo de 0: se acota el delta para conservar las duraciones.
  const d = Math.max(delta, -l.startMs);
  return {
    ...l,
    startMs: l.startMs + d,
    endMs: l.endMs !== undefined ? l.endMs + d : undefined,
    words: l.words?.map((w) => ({ ...w, startTime: w.startTime + d, endTime: w.endTime + d })),
  };
};

/** Mueve la línea ENTERA (sus palabras y su fin) para que empiece en `ms`. */
export function setStart(doc: StudioDoc, id: string, ms: number): StudioDoc {
  const target = Math.max(0, Math.round(ms));
  return mapLine(doc, id, (l) => {
    if (l.startMs === null) return { ...l, startMs: target, endMs: undefined };
    return shiftLine(l, target - l.startMs);
  });
}

export const nudge = (doc: StudioDoc, id: string, deltaMs: number): StudioDoc =>
  mapLine(doc, id, (l) => shiftLine(l, deltaMs));

/** Desplaza todas las líneas sincronizadas (corrige un desfase global). */
export function shiftAll(doc: StudioDoc, deltaMs: number): StudioDoc {
  const minStart = Math.min(...doc.lines.filter((l) => l.startMs !== null).map((l) => l.startMs as number), Infinity);
  const d = Number.isFinite(minStart) ? Math.max(deltaMs, -minStart) : 0;
  return {
    ...doc,
    lines: doc.lines.map((l) => shiftLine(l, d)),
    breaks: doc.breaks.map((b) => ({ startMs: Math.max(0, b.startMs + d), endMs: Math.max(0, b.endMs + d) })),
  };
}

/** Cambiar el texto invalida los tiempos por palabra (ya no corresponden), pero conserva la línea. */
export const setText = (doc: StudioDoc, id: string, text: string): StudioDoc =>
  mapLine(doc, id, (l) => (l.text === text ? l : { ...l, text, words: undefined, flags: l.flags?.filter((f) => f !== 'interpolated_words') }));

export const removeLine = (doc: StudioDoc, id: string): StudioDoc => ({
  ...doc,
  lines: doc.lines.filter((l) => l.id !== id),
});

export function insertAfter(doc: StudioDoc, id: string, text = ''): StudioDoc {
  const i = doc.lines.findIndex((l) => l.id === id);
  const at = i < 0 ? doc.lines.length : i + 1;
  const lines = [...doc.lines];
  lines.splice(at, 0, { id: newId(), text, startMs: null });
  return { ...doc, lines };
}

export function mergeWithNext(doc: StudioDoc, id: string): StudioDoc {
  const i = doc.lines.findIndex((l) => l.id === id);
  if (i < 0 || i >= doc.lines.length - 1) return doc;
  const a = doc.lines[i];
  const b = doc.lines[i + 1];
  const merged: StudioLine = {
    ...a,
    text: `${a.text} ${b.text}`.trim(),
    endMs: b.endMs ?? a.endMs,
    words: a.words && b.words ? [...a.words, ...b.words] : undefined,
    confidence: a.confidence !== undefined && b.confidence !== undefined ? Math.min(a.confidence, b.confidence) : a.confidence,
  };
  const lines = [...doc.lines];
  lines.splice(i, 2, merged);
  return { ...doc, lines };
}

export const sortByTime = (doc: StudioDoc): StudioDoc => ({
  ...doc,
  lines: [...doc.lines].sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity)),
});

/**
 * Sincronización manual ("tap sync"): asigna `ms` a la primera línea sin tiempo.
 * Devuelve el documento y el id de la línea marcada (o null si ya no queda ninguna).
 */
export function tapSync(doc: StudioDoc, ms: number): { doc: StudioDoc; id: string | null } {
  const line = doc.lines.find((l) => l.startMs === null);
  if (!line) return { doc, id: null };
  return { doc: setStart(doc, line.id, ms), id: line.id };
}

export const untimedCount = (doc: StudioDoc): number => doc.lines.filter((l) => l.startMs === null).length;

/* ------------------------------------------------------------------ validación */

export interface EditorIssue {
  lineId: string;
  kind: 'untimed' | 'out_of_order' | 'too_close' | 'beyond_audio';
  message: string;
}

export function validate(doc: StudioDoc): EditorIssue[] {
  const issues: EditorIssue[] = [];
  let prev: StudioLine | null = null;
  for (const l of doc.lines) {
    if (l.startMs === null) {
      issues.push({ lineId: l.id, kind: 'untimed', message: 'Sin tiempo' });
      continue;
    }
    if (doc.durationMs > 0 && l.startMs > doc.durationMs) {
      issues.push({ lineId: l.id, kind: 'beyond_audio', message: 'Empieza después del final del audio' });
    }
    if (prev && prev.startMs !== null) {
      if (l.startMs < prev.startMs) issues.push({ lineId: l.id, kind: 'out_of_order', message: 'Empieza antes que la línea anterior' });
      else if (l.startMs - prev.startMs < MIN_LINE_MS) issues.push({ lineId: l.id, kind: 'too_close', message: 'Casi idéntica a la anterior' });
    }
    prev = l;
  }
  return issues;
}

/* ------------------------------------------------------------------ exportación y vista previa */

/** Documento → modelo del motor (con pausas instrumentales) para previsualizar y exportar. */
export function toSyncedLyrics(doc: StudioDoc, trackId = 'studio'): SyncedLyrics {
  const raw: RawLine[] = doc.lines
    .filter((l): l is StudioLine & { startMs: number } => l.startMs !== null && l.text.trim() !== '')
    .map((l) => ({
      start: l.startMs,
      end: l.endMs,
      text: l.text,
      words: l.words?.map((w) => ({ text: w.text, start: w.startTime, end: w.endTime })),
    }));
  // Pausas medidas (o inferidas por el servicio): se pasan como marcas de silencio explícitas.
  for (const b of doc.breaks) raw.push({ start: b.startMs, text: '' });
  const lines = buildLines(raw, doc.durationMs || undefined);
  const sung = lines.filter((l) => !l.isBreak);
  return {
    trackId,
    language: doc.language,
    source: doc.source === 'manual' || doc.source === 'import' ? 'liriks-studio' : doc.source === 'ai-demo' ? 'liriks-ai-demo' : 'liriks-ai',
    synchronizationType: sung.length === 0 ? 'none' : sung.some((l) => l.words?.length) ? 'word' : 'line',
    duration: doc.durationMs,
    lines,
  };
}

/** 12_340 → "00:12.34" (acarreo correcto al redondear). */
export function lrcTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();

export interface ExportMeta {
  title?: string;
  artist?: string;
}

export function toLrc(doc: StudioDoc, opts: { enhanced?: boolean } & ExportMeta = {}): string {
  const out: string[] = [];
  if (opts.title) out.push(`[ti:${oneLine(opts.title)}]`);
  if (opts.artist) out.push(`[ar:${oneLine(opts.artist)}]`);
  if (doc.durationMs) out.push(`[length:${lrcTime(doc.durationMs).slice(0, 5)}]`);
  out.push('[re:Liriks]');
  if (doc.source === 'ai-demo') out.push('[by:DEMO - no es una sincronizacion real]');
  const timed = doc.lines.filter((l) => l.startMs !== null && l.text.trim() !== '');
  for (const l of [...timed].sort((a, b) => (a.startMs as number) - (b.startMs as number))) {
    let body = oneLine(l.text);
    if (opts.enhanced && l.words?.length) {
      body = l.words.map((w) => `<${lrcTime(w.startTime)}>${oneLine(w.text)}`).join(' ') + ` <${lrcTime(l.words[l.words.length - 1].endTime)}>`;
    }
    out.push(`[${lrcTime(l.startMs as number)}]${body}`);
  }
  return out.join('\n') + '\n';
}

/** JSON compatible con el que exporta el servicio de IA (se puede volver a importar). */
export function toJson(doc: StudioDoc, meta: ExportMeta & { trackId?: string } = {}): string {
  const synced = toSyncedLyrics(doc, meta.trackId ?? 'studio');
  const byText = new Map(doc.lines.map((l) => [`${l.startMs}|${oneLine(l.text)}`, l]));
  const lines = synced.lines.map((l) => {
    const src = byText.get(`${l.startTime}|${l.text}`);
    return {
      id: l.id,
      text: l.text,
      startTime: l.startTime,
      endTime: l.endTime,
      isBreak: l.isBreak,
      ...(l.words?.length ? { words: l.words.map((w) => ({ text: oneLine(w.text), startTime: w.startTime, endTime: w.endTime })) } : {}),
      ...(src?.confidence !== undefined ? { confidence: src.confidence } : {}),
      ...(src?.flags?.length ? { flags: src.flags } : {}),
    };
  });
  return (
    JSON.stringify(
      {
        format: 'liriks-synced-lyrics',
        version: 1,
        trackId: synced.trackId,
        source: synced.source,
        language: synced.language ?? null,
        synchronizationType: synced.synchronizationType,
        duration: synced.duration,
        lines,
        meta: {
          title: meta.title ?? null,
          artist: meta.artist ?? null,
          overallConfidence: doc.overallConfidence ?? null,
          warnings: doc.warnings,
        },
      },
      null,
      2,
    ) + '\n'
  );
}

/* ------------------------------------------------------------------ entrada de tiempos */

/** "1:23.45" | "83.45" | "83" → ms; null si no es válido. */
export function parseTimeInput(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const m = /^(?:(\d{1,3}):)?(\d{1,3})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return null;
  const min = m[1] ? Number(m[1]) : 0;
  const sec = Number(m[2]);
  if (m[1] && sec >= 60) return null;
  const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
  return min * 60_000 + sec * 1000 + frac;
}

/** ms → "1:23.45" para campos de edición. */
export function formatTimeInput(ms: number | null): string {
  if (ms === null) return '';
  const cs = Math.round(ms / 10);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
