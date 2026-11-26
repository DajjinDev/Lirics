import { describe, expect, it } from 'vitest';
import { LyricsSyncEngine } from './lyrics-sync-engine';
import { lrcToSyncedLyrics } from './lrc-parser';
import { lyricsfileToSyncedLyrics } from './lyricsfile-parser';

const LRC = `[00:05.00] uno
[00:09.00] dos
[00:13.00] tres
[00:40.00] cuatro`;

const make = (mode: 'real' | 'approximate' | 'off' = 'real') =>
  new LyricsSyncEngine(
    lrcToSyncedLyrics(LRC, { trackId: 't', sourceName: 'x', durationMs: 60_000 }),
    mode,
  );

const idxOf = (e: LyricsSyncEngine, text: string) => e.lines.findIndex((l) => l.text === text);

describe('LyricsSyncEngine — línea activa', () => {
  it('antes de la primera línea no hay activa (una intro corta no es pausa)', () => {
    const e = new LyricsSyncEngine(
      lrcToSyncedLyrics('[00:02.00] primera', { trackId: 't', sourceName: 'x' }),
    );
    const s = e.resolve(1000);
    expect(s.activeIndex).toBe(-1);
    expect(s.phase).toBe('before');
  });

  it('una intro de 5 s se muestra como pausa instrumental', () => {
    const e = make();
    const s = e.resolve(2000);
    expect(s.isBreak).toBe(true);
    expect(e.lines[s.activeIndex].startTime).toBe(0);
  });

  it('activa cada línea en su instante exacto', () => {
    const e = make();
    expect(e.lines[e.resolve(5000).activeIndex].text).toBe('uno');
    expect(e.lines[e.resolve(4999).activeIndex]?.text).not.toBe('uno');
    expect(e.lines[e.resolve(9000).activeIndex].text).toBe('dos');
    expect(e.lines[e.resolve(12_999).activeIndex].text).toBe('dos');
  });

  it('calcula el progreso de la línea', () => {
    const e = make();
    const s = e.resolve(5900); // uno: 5000..6800 (duración estimada de la línea)
    expect(s.lineProgress).toBeCloseTo(0.5, 1);
  });

  it('mantiene la última línea tras terminar la canción', () => {
    const e = make();
    const s = e.resolve(300_000);
    expect(e.lines[s.activeIndex].text).toBe('cuatro');
    expect(s.phase).toBe('after');
    expect(s.lineProgress).toBe(1);
  });
});

describe('LyricsSyncEngine — seek y reproducción discontinua', () => {
  it('recalcula bien al adelantar y al retroceder', () => {
    const e = make();
    const seq = [6000, 10_000, 14_000, 41_000, 6000, 10_000, 41_000, 0, 14_000];
    const got = seq.map((t) => e.lines[e.resolve(t).activeIndex]?.text);
    expect(got).toEqual(['uno', 'dos', 'tres', 'cuatro', 'uno', 'dos', 'cuatro', '', 'tres']);
  });

  it('es consistente con una búsqueda lineal para muchos instantes aleatorios', () => {
    const e = make();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const t = Math.floor(rnd() * 70_000);
      let expected = -1;
      e.lines.forEach((l, k) => {
        if (l.startTime <= t) expected = k;
      });
      expect(e.resolve(t).activeIndex).toBe(expected);
    }
  });

  it('dos consultas con el mismo tiempo (pausa) dan el mismo resultado', () => {
    const e = make();
    expect(e.resolve(10_000)).toEqual(e.resolve(10_000));
  });
});

describe('LyricsSyncEngine — offset', () => {
  it('offset positivo retrasa las letras', () => {
    const e = make();
    expect(e.lines[e.resolve(5000, 0).activeIndex].text).toBe('uno');
    // Con +200 ms, a 5.1 s la línea 'uno' todavía no debe estar activa.
    expect(e.lines[e.resolve(5100, 200).activeIndex].text).not.toBe('uno');
    expect(e.lines[e.resolve(5200, 200).activeIndex].text).toBe('uno');
  });

  it('offset negativo adelanta las letras', () => {
    const e = make();
    expect(e.lines[e.resolve(4800, -200).activeIndex].text).toBe('uno');
  });
});

describe('LyricsSyncEngine — pausas instrumentales', () => {
  it('reporta isBreak con progreso durante el hueco largo', () => {
    const e = make();
    const s = e.resolve(25_000);
    expect(s.isBreak).toBe(true);
    expect(s.breakProgress).toBeGreaterThan(0);
    expect(s.breakProgress).toBeLessThan(1);
    // Al volver el canto, deja de ser pausa.
    expect(e.resolve(40_500).isBreak).toBe(false);
  });

  it('la intro larga es una pausa que comienza en 0', () => {
    const e = new LyricsSyncEngine(
      lrcToSyncedLyrics('[00:20.00]hola', { trackId: 't', sourceName: 'x' }),
    );
    const s = e.resolve(3000);
    expect(s.isBreak).toBe(true);
    expect(s.activeIndex).toBe(0);
  });
});

describe('LyricsSyncEngine — palabras', () => {
  const YAML = `
version: '1.0'
metadata:
  duration_ms: 30000
lines:
- text: uno dos tres
  start_ms: 1000
  end_ms: 4000
  words:
  - text: 'uno '
    start_ms: 1000
  - text: 'dos '
    start_ms: 2000
  - text: tres
    start_ms: 3000
- text: sin palabras
  start_ms: 5000
  end_ms: 7000
`;
  const lyrics = lyricsfileToSyncedLyrics(YAML, { trackId: 't', sourceName: 'x' })!;

  it('interpreta el formato por palabras', () => {
    expect(lyrics.synchronizationType).toBe('word');
    expect(lyrics.lines[0].words).toHaveLength(3);
    expect(lyrics.lines[0].words![2].endTime).toBe(4000);
  });

  it('devuelve la palabra activa y su progreso', () => {
    const e = new LyricsSyncEngine(lyrics, 'real');
    const s = e.resolve(2500);
    expect(s.wordIndex).toBe(1);
    expect(s.wordProgress).toBeCloseTo(0.5, 2);
  });

  it('en modo real no inventa palabras para líneas sin ellas', () => {
    const e = new LyricsSyncEngine(lyrics, 'real');
    const s = e.resolve(5500);
    expect(s.wordIndex).toBe(-1);
    expect(e.isApproximate(1)).toBe(false);
  });

  it('en modo aproximado reparte y lo declara como aproximado', () => {
    const e = new LyricsSyncEngine(lyrics, 'approximate');
    const idx = lyrics.lines.findIndex((l) => l.text === 'sin palabras');
    const s = e.resolve(5500);
    expect(s.wordIndex).toBe(0);
    expect(e.isApproximate(idx)).toBe(true);
    expect(e.isApproximate(0)).toBe(false);
  });

  it('un YAML inválido devuelve null para usar el LRC', () => {
    expect(lyricsfileToSyncedLyrics(': : [', { trackId: 't', sourceName: 'x' })).toBeNull();
    expect(lyricsfileToSyncedLyrics('lines: []', { trackId: 't', sourceName: 'x' })).toBeNull();
  });
});

describe('LyricsSyncEngine — datos extremos', () => {
  it('no falla sin líneas', () => {
    const e = new LyricsSyncEngine({
      trackId: 't',
      source: 'x',
      synchronizationType: 'none',
      duration: 0,
      lines: [],
    });
    expect(e.resolve(1000).activeIndex).toBe(-1);
  });

  it('marca la línea con texto correcto tras las pausas', () => {
    const e = make();
    expect(idxOf(e, 'cuatro')).toBeGreaterThan(idxOf(e, 'tres'));
  });
});
