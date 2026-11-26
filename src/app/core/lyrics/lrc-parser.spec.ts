import { describe, expect, it } from 'vitest';
import { lrcToSyncedLyrics, parseLrc, timeTagToMs } from './lrc-parser';

// Datos ficticios (no corresponden a ninguna canción real).
const SAMPLE = `[ar:Artista Ficticio]
[ti:Canción de prueba]
[00:05.20] La noche nos acompaña
[00:09.40] Y el tiempo deja de pasar
[00:13.80] Bajo la luz de la luna
[00:18.50] Volvemos a comenzar`;

describe('timeTagToMs', () => {
  it('interpreta centésimas, milésimas y décimas', () => {
    expect(timeTagToMs('01', '23', '45')).toBe(83_450);
    expect(timeTagToMs('00', '05', '200')).toBe(5200);
    expect(timeTagToMs('00', '05', '2')).toBe(5200);
    expect(timeTagToMs('02', '00')).toBe(120_000);
  });
});

describe('parseLrc', () => {
  it('lee líneas con su tiempo de inicio en milisegundos', () => {
    const { lines } = parseLrc(SAMPLE);
    expect(lines.map((l) => l.start)).toEqual([5200, 9400, 13800, 18500]);
    expect(lines[0].text).toBe('La noche nos acompaña');
  });

  it('extrae metadatos sin tratarlos como letra', () => {
    const { meta, lines } = parseLrc(SAMPLE);
    expect(meta['ar']).toBe('Artista Ficticio');
    expect(meta['ti']).toBe('Canción de prueba');
    expect(lines).toHaveLength(4);
  });

  it('ordena marcas desordenadas', () => {
    const { lines } = parseLrc('[00:10.00]segunda\n[00:02.00]primera\n[00:20.00]tercera');
    expect(lines.map((l) => l.text)).toEqual(['primera', 'segunda', 'tercera']);
  });

  it('expande varias marcas en una línea (estribillo repetido)', () => {
    const { lines } = parseLrc('[00:10.00][01:30.50]estribillo');
    expect(lines.map((l) => l.start)).toEqual([10_000, 90_500]);
    expect(lines.every((l) => l.text === 'estribillo')).toBe(true);
  });

  it('descarta duplicados exactos y los cuenta', () => {
    const r = parseLrc('[00:10.00]hola\n[00:10.00]hola\n[00:10.00]otra');
    expect(r.lines).toHaveLength(2);
    expect(r.duplicatesDropped).toBe(1);
  });

  it('aplica [offset:] con la convención LRC (positivo = antes)', () => {
    const { lines, offsetMs } = parseLrc('[offset:+500]\n[00:10.00]hola');
    expect(offsetMs).toBe(500);
    expect(lines[0].start).toBe(9500);
  });

  it('no deja tiempos negativos con offset grande', () => {
    expect(parseLrc('[offset:5000]\n[00:01.00]hola').lines[0].start).toBe(0);
  });

  it('conserva líneas vacías como marcas de silencio y elimina etiquetas por palabra', () => {
    const { lines } = parseLrc('[00:01.00]<00:01.00>hola <00:01.50>mundo\n[00:05.00]');
    expect(lines[0].text).toBe('hola mundo');
    expect(lines[1].text).toBe('');
  });

  it('tolera CRLF y texto sin marca', () => {
    const { lines } = parseLrc('texto suelto\r\n[00:01.00]uno\r\n');
    expect(lines).toHaveLength(1);
  });
});

describe('lrcToSyncedLyrics', () => {
  const opts = { trackId: 't', sourceName: 'test' };

  it('calcula el fin de cada línea como el inicio de la siguiente', () => {
    const s = lrcToSyncedLyrics(SAMPLE, { ...opts, durationMs: 60_000 });
    const sung = s.lines.filter((l) => !l.isBreak);
    expect(sung[0].endTime).toBeLessThanOrEqual(sung[1].startTime);
    expect(s.synchronizationType).toBe('line');
  });

  it('inserta una pausa instrumental al inicio si la intro es larga', () => {
    const s = lrcToSyncedLyrics('[00:20.00]empieza', opts);
    expect(s.lines[0].isBreak).toBe(true);
    expect(s.lines[0].startTime).toBe(0);
    expect(s.lines[0].endTime).toBe(20_000);
  });

  it('no inserta pausa si la primera línea llega pronto', () => {
    const s = lrcToSyncedLyrics('[00:02.00]empieza', opts);
    expect(s.lines.some((l) => l.isBreak)).toBe(false);
  });

  it('detecta una pausa instrumental por hueco largo entre frases', () => {
    const s = lrcToSyncedLyrics('[00:10.00]uno\n[00:40.00]dos', opts);
    const br = s.lines.filter((l) => l.isBreak);
    expect(br.some((b) => b.startTime > 10_000 && b.endTime === 40_000)).toBe(true);
  });

  it('una marca vacía acorta la línea anterior y marca el silencio', () => {
    const s = lrcToSyncedLyrics('[00:10.00]uno\n[00:13.00]\n[00:30.00]dos', opts);
    const uno = s.lines.find((l) => l.text === 'uno')!;
    expect(uno.endTime).toBe(13_000);
    expect(s.lines.some((l) => l.isBreak && l.startTime === 13_000)).toBe(true);
  });

  it('ignora silencios cortos entre estrofas', () => {
    const s = lrcToSyncedLyrics('[00:10.00]uno\n[00:12.00]\n[00:13.00]dos', opts);
    expect(s.lines.some((l) => l.isBreak && l.startTime > 0)).toBe(false);
  });

  it('marca el fin de línea como inferido cuando el LRC no lo trae', () => {
    const s = lrcToSyncedLyrics('[00:10.00]uno\n[00:14.00]dos', opts);
    const sung = s.lines.filter((l) => !l.isBreak);
    expect(sung.every((l) => l.endInferred === true)).toBe(true);
  });

  it('un silencio marcado en el archivo hace real el fin de la línea anterior', () => {
    const s = lrcToSyncedLyrics('[00:10.00]uno\n[00:13.00]\n[00:30.00]dos', opts);
    expect(s.lines.find((l) => l.text === 'uno')!.endInferred).toBe(false);
  });

  it('un hueco largo SIN marca de silencio no inventa el final: queda estimado', () => {
    const s = lrcToSyncedLyrics('[00:10.00]uno\n[00:40.00]dos', opts);
    expect(s.lines.find((l) => l.text === 'uno')!.endInferred).toBe(true);
  });

  it('un archivo sin marcas válidas queda como none', () => {
    expect(lrcToSyncedLyrics('solo texto', opts).synchronizationType).toBe('none');
  });
});
