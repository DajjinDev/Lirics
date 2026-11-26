import { describe, expect, it } from 'vitest';
import {
  formatTimeInput,
  fromJsonText,
  fromLrcText,
  fromPlainText,
  fromServiceResult,
  insertAfter,
  lrcTime,
  mergeWithNext,
  nudge,
  parseTimeInput,
  removeLine,
  ServiceResult,
  setStart,
  setText,
  shiftAll,
  sortByTime,
  StudioDoc,
  tapSync,
  toJson,
  toLrc,
  toSyncedLyrics,
  untimedCount,
  validate,
} from './lyrics-editor';
import { LyricsSyncEngine } from './lyrics-sync-engine';
import { PYTHON_EXPORT } from './python-fixtures';

const doc = (): StudioDoc => ({
  lines: [
    {
      id: 'a',
      text: 'hola mundo',
      startMs: 10_000,
      endMs: 12_000,
      words: [
        { text: 'hola ', startTime: 10_000, endTime: 11_000 },
        { text: 'mundo', startTime: 11_000, endTime: 12_000 },
      ],
      confidence: 0.9,
    },
    { id: 'b', text: 'segunda línea', startMs: 20_000, endMs: 22_000 },
    { id: 'c', text: 'sin tiempo', startMs: null },
  ],
  durationMs: 60_000,
  source: 'ai',
  warnings: [],
  breaks: [],
});

const line = (d: StudioDoc, id: string) => d.lines.find((l) => l.id === id)!;

describe('edición inmutable', () => {
  it('setStart mueve la línea ENTERA conservando duraciones de palabra', () => {
    const d = setStart(doc(), 'a', 15_000);
    const a = line(d, 'a');
    expect(a.startMs).toBe(15_000);
    expect(a.endMs).toBe(17_000);
    expect(a.words!.map((w) => [w.startTime, w.endTime])).toEqual([
      [15_000, 16_000],
      [16_000, 17_000],
    ]);
  });

  it('no muta el documento original', () => {
    const original = doc();
    const snapshot = JSON.stringify(original);
    setStart(original, 'a', 1);
    nudge(original, 'b', 100);
    shiftAll(original, 500);
    setText(original, 'a', 'otro');
    removeLine(original, 'a');
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('nudge no baja de 0 y conserva la duración', () => {
    const d = nudge(doc(), 'a', -50_000);
    expect(line(d, 'a').startMs).toBe(0);
    expect(line(d, 'a').endMs).toBe(2_000);
  });

  it('shiftAll desplaza todo y se detiene cuando la primera línea llega a 0', () => {
    const d = shiftAll(doc(), 300);
    expect(line(d, 'a').startMs).toBe(10_300);
    expect(line(d, 'b').startMs).toBe(20_300);
    expect(line(d, 'c').startMs).toBeNull();
    const back = shiftAll(doc(), -99_000);
    expect(line(back, 'a').startMs).toBe(0);
    expect(line(back, 'b').startMs).toBe(10_000); // la separación entre líneas se conserva
  });

  it('shiftAll desplaza también las pausas', () => {
    const d = shiftAll({ ...doc(), breaks: [{ startMs: 1000, endMs: 5000 }] }, 200);
    expect(d.breaks[0]).toEqual({ startMs: 1200, endMs: 5200 });
  });

  it('cambiar el texto invalida los tiempos por palabra pero conserva el tiempo de línea', () => {
    const a = line(setText(doc(), 'a', 'hola a todos'), 'a');
    expect(a.text).toBe('hola a todos');
    expect(a.words).toBeUndefined();
    expect(a.startMs).toBe(10_000);
  });

  it('mismo texto: no se pierden las palabras', () => {
    expect(line(setText(doc(), 'a', 'hola mundo'), 'a').words).toHaveLength(2);
  });

  it('insertar, eliminar, unir', () => {
    let d = insertAfter(doc(), 'a', 'nueva');
    expect(d.lines.map((l) => l.text)).toEqual(['hola mundo', 'nueva', 'segunda línea', 'sin tiempo']);
    expect(d.lines[1].startMs).toBeNull();
    d = removeLine(d, d.lines[1].id);
    expect(d.lines).toHaveLength(3);
    const merged = mergeWithNext(doc(), 'a');
    expect(line(merged, 'a').text).toBe('hola mundo segunda línea');
    expect(line(merged, 'a').endMs).toBe(22_000);
    expect(merged.lines).toHaveLength(2);
    expect(mergeWithNext(doc(), 'c').lines).toHaveLength(3); // la última no se une con nada
  });

  it('ordenar por tiempo deja las sin tiempo al final', () => {
    const shuffled: StudioDoc = { ...doc(), lines: [...doc().lines].reverse() };
    expect(sortByTime(shuffled).lines.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('sincronización manual (tap sync)', () => {
  it('asigna el tiempo a la primera línea sin sincronizar, en orden', () => {
    const start = fromPlainText('uno\ndos\ntres');
    expect(untimedCount(start)).toBe(3);
    const t1 = tapSync(start, 1500);
    const t2 = tapSync(t1.doc, 4200);
    const t3 = tapSync(t2.doc, 7000);
    expect(t3.doc.lines.map((l) => l.startMs)).toEqual([1500, 4200, 7000]);
    expect(untimedCount(t3.doc)).toBe(0);
    expect(tapSync(t3.doc, 9000).id).toBeNull(); // ya no quedan líneas
  });
});

describe('validación', () => {
  it('detecta líneas sin tiempo, desordenadas y fuera del audio', () => {
    const d = { ...doc(), lines: [...doc().lines, { id: 'z', text: 'tarde', startMs: 99_000 }, { id: 'y', text: 'antes', startMs: 500 }] };
    const kinds = validate(d).map((i) => `${i.lineId}:${i.kind}`);
    expect(kinds).toContain('c:untimed');
    expect(kinds).toContain('z:beyond_audio');
    expect(kinds).toContain('y:out_of_order');
  });

  it('un documento correcto no tiene problemas', () => {
    expect(validate({ ...doc(), lines: doc().lines.slice(0, 2) })).toEqual([]);
  });
});

describe('importación', () => {
  it('texto plano: líneas limpias, sin etiquetas de sección', () => {
    const d = fromPlainText('[Chorus]\n  Hola   mundo \n\n(oh oh)\n[Verso 1]\nfin');
    expect(d.lines.map((l) => l.text)).toEqual(['Hola mundo', '(oh oh)', 'fin']);
    expect(d.source).toBe('manual');
  });

  it('LRC: líneas con tiempo y sin las marcas vacías', () => {
    const d = fromLrcText('[00:05.00]uno\n[00:09.50]\n[00:20.00]dos');
    expect(d.lines.map((l) => [l.text, l.startMs])).toEqual([
      ['uno', 5000],
      ['dos', 20_000],
    ]);
  });

  it('JSON: rechaza formatos ajenos y contenido corrupto', () => {
    expect(() => fromJsonText('no json')).toThrow(/JSON válido/);
    expect(() => fromJsonText('{"format":"otro","lines":[]}')).toThrow(/liriks-synced-lyrics/);
    expect(() => fromJsonText('{"format":"liriks-synced-lyrics"}')).toThrow();
  });

  it('JSON: ignora entradas malformadas sin romperse', () => {
    const d = fromJsonText(
      JSON.stringify({
        format: 'liriks-synced-lyrics',
        lines: [
          { text: 'ok', startTime: 1000, endTime: 2000 },
          { text: 5, startTime: 1, endTime: 2 },
          { text: 'sin tiempo' },
          null,
          { text: 'neg', startTime: -5, endTime: 1 },
          { text: '', startTime: 3000, endTime: 9000, isBreak: true },
        ],
      }),
    );
    expect(d.lines.map((l) => l.text)).toEqual(['ok']);
    expect(d.breaks).toEqual([{ startMs: 3000, endMs: 9000 }]);
  });

  it('resultado del servicio: mapea snake_case, palabras, confianza y modo demo', () => {
    const r: ServiceResult = {
      language: 'es',
      duration_ms: 30_000,
      mode: 'transcribed',
      engine: { demo: true },
      lines: [{ id: 'a0', text: 'hola', start_ms: 1000, end_ms: 2000, confidence: 0.4, flags: ['low_confidence'], words: [{ text: 'hola', start_ms: 1000, end_ms: 2000 }] }],
      breaks: [{ start_ms: 0, end_ms: 1000 }],
      overall_confidence: 0.4,
      warnings: ['w'],
    };
    const d = fromServiceResult(r);
    expect(d.source).toBe('ai-demo');
    expect(d.lines[0]).toMatchObject({ startMs: 1000, endMs: 2000, confidence: 0.4, flags: ['low_confidence'] });
    expect(d.lines[0].words![0]).toEqual({ text: 'hola', startTime: 1000, endTime: 2000 });
    expect(d.breaks).toEqual([{ startMs: 0, endMs: 1000 }]);
  });
});

describe('interoperabilidad con el servicio Python', () => {
  it('importa el JSON exportado por Python', () => {
    const d = fromJsonText(PYTHON_EXPORT.json);
    expect(d.lines.map((l) => l.text)).toEqual(['hola mundo', 'otra linea']);
    expect(d.lines[0].words).toHaveLength(2);
    expect(d.lines[0].startMs).toBe(12_340);
    expect(d.breaks).toEqual([{ startMs: 0, endMs: 12_000 }]);
    expect(d.durationMs).toBe(65_000);
    expect(d.overallConfidence).toBe(0.7);
  });

  it('nuestro LRC coincide línea a línea con el de Python', () => {
    const d = fromJsonText(PYTHON_EXPORT.json);
    const stamped = (s: string) => s.split('\n').filter((l) => /^\[\d\d:\d\d\.\d\d\]/.test(l));
    expect(stamped(toLrc(d))).toEqual(stamped(PYTHON_EXPORT.lrc));
    expect(stamped(toLrc(d, { enhanced: true }))).toEqual(stamped(PYTHON_EXPORT.lrcEnhanced));
  });

  it('el JSON que exportamos vuelve a importarse sin pérdida', () => {
    const d = fromJsonText(PYTHON_EXPORT.json);
    const again = fromJsonText(toJson(d, { title: 'T' }));
    expect(again.lines.map((l) => [l.text, l.startMs, l.endMs])).toEqual(d.lines.map((l) => [l.text, l.startMs, l.endMs]));
    expect(again.lines[0].words).toEqual(d.lines[0].words);
  });

  it('el LRC exportado lo entiende el parser LRC existente del reproductor', () => {
    const d = fromJsonText(PYTHON_EXPORT.json);
    const back = fromLrcText(toLrc(d));
    expect(back.lines.map((l) => [l.text, l.startMs])).toEqual([
      ['hola mundo', 12_340],
      ['otra linea', 30_000],
    ]);
  });
});

describe('exportación', () => {
  it('LRC: omite líneas sin tiempo, ordena y rotula la demostración', () => {
    const out = toLrc({ ...doc(), source: 'ai-demo', lines: [...doc().lines].reverse() }, { title: 'T', artist: 'A' });
    expect(out).toContain('[ti:T]');
    expect(out).toContain('DEMO');
    const stamped = out.split('\n').filter((l) => l.startsWith('[0'));
    expect(stamped).toEqual(['[00:10.00]hola mundo', '[00:20.00]segunda línea']);
    expect(out).not.toContain('sin tiempo');
  });

  it('LRC por palabra incluye <tiempo> antes de cada palabra y el cierre', () => {
    expect(toLrc(doc(), { enhanced: true })).toContain('[00:10.00]<00:10.00>hola <00:11.00>mundo <00:12.00>');
  });

  it('lrcTime con acarreo', () => {
    expect(lrcTime(59_996)).toBe('01:00.00');
    expect(lrcTime(12_340)).toBe('00:12.34');
  });

  it('la vista previa usa el motor del reproductor: activa la línea correcta y respeta palabras', () => {
    const synced = toSyncedLyrics(doc());
    expect(synced.synchronizationType).toBe('word');
    const engine = new LyricsSyncEngine(synced);
    const s = engine.resolve(11_500);
    expect(engine.lines[s.activeIndex].text).toBe('hola mundo');
    expect(s.wordIndex).toBe(1);
    expect(engine.lines.some((l) => l.isBreak)).toBe(true); // intro de 10 s
  });

  it('las pausas medidas por el servicio se respetan', () => {
    const synced = toSyncedLyrics({ ...doc(), lines: doc().lines.slice(0, 2), breaks: [{ startMs: 12_500, endMs: 19_500 }] });
    // La pausa arranca al terminar la línea anterior (12 000) y llega hasta el siguiente canto (20 000).
    const brk = synced.lines.find((l) => l.isBreak && l.startTime > 0);
    expect(brk).toMatchObject({ startTime: 12_000, endTime: 20_000 });
  });

  it('un documento sin líneas sincronizadas es "none"', () => {
    expect(toSyncedLyrics(fromPlainText('a\nb')).synchronizationType).toBe('none');
  });
});

describe('entrada de tiempos', () => {
  it('interpreta formatos habituales', () => {
    expect(parseTimeInput('1:23.45')).toBe(83_450);
    expect(parseTimeInput('83,4')).toBe(83_400);
    expect(parseTimeInput('7')).toBe(7000);
    expect(parseTimeInput('0:05.5')).toBe(5500);
  });

  it('rechaza lo no válido', () => {
    for (const bad of ['', 'abc', '1:75', '-3', '1:2:3', '1.2.3']) expect(parseTimeInput(bad)).toBeNull();
  });

  it('formatTimeInput es el inverso', () => {
    expect(formatTimeInput(83_450)).toBe('1:23.45');
    expect(formatTimeInput(null)).toBe('');
    for (const ms of [0, 5500, 59_990, 600_000]) expect(parseTimeInput(formatTimeInput(ms))).toBe(ms);
  });
});
