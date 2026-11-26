/**
 * Regresiones descubiertas con la prueba EN VIVO contra los proveedores reales
 * (títulos ruidosos del catálogo, obras instrumentales, versiones distintas).
 */
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LyricsCandidate } from '../models/lyrics.models';
import { Track } from '../models/music.models';
import { LrclibProvider } from '../providers/lrclib.provider';
import { rankPlainFirst } from '../providers/itunes.provider';
import { LyricsService } from '../services/lyrics.service';
import { instrumentalConsensus, matchLevel, scoreLyricsCandidate } from './track-matcher';
import { parseYouTubeTitle, stripNoise, stripParentheticals, titlePrefixes, titleSimilarity, titleVariants } from './text-normalize';

const cand = (over: Partial<LyricsCandidate> = {}): LyricsCandidate => ({
  providerId: 'fake',
  externalId: Math.random().toString(36),
  trackName: 'Clair de Lune',
  artistName: 'Claude Debussy',
  albumName: undefined,
  durationMs: 216_000,
  instrumental: true,
  ...over,
});

describe('títulos ruidosos del catálogo', () => {
  it('stripParentheticals y titleVariants', () => {
    expect(stripParentheticals('Clair de lune (moonlight) Debussy Classic lullaby')).toBe('Clair de lune Debussy Classic lullaby');
    expect(stripParentheticals('Tema [Remastered 2011] (feat. X)')).toBe('Tema');
    expect(titleVariants('Clair de lune (moonlight) Debussy Classic lullaby')).toEqual([
      'Clair de lune (moonlight) Debussy Classic lullaby',
      'Clair de lune Debussy Classic lullaby',
    ]);
    expect(titleVariants('Tema - Remastered 2011')).toEqual(['Tema - Remastered 2011', 'Tema']);
    expect(titleVariants('  ')).toEqual([]);
  });

  it('el título con texto entre paréntesis sigue pareciéndose al título limpio', () => {
    expect(titleSimilarity('Clair de lune (moonlight) Debussy Classic lullaby', 'Clair de Lune')).toBeGreaterThanOrEqual(0.8);
    expect(titleSimilarity('Tema (Remastered 2011)', 'Tema')).toBe(1);
  });

  it('pero un tema distinto NO se confunde por ignorar paréntesis', () => {
    expect(titleSimilarity('Amor (Live)', 'Dolor')).toBeLessThan(0.5);
    expect(titleSimilarity('(Intro)', '(Outro)')).toBeLessThan(0.8);
  });

  it('una versión distinta (live/remix) NUNCA supera "incierta", aunque coincida la duración', () => {
    const wanted = { title: 'Noches de Prueba', artist: 'Artista Ficticio', album: 'Álbum', durationMs: 200_000 };
    for (const name of ['Noches de Prueba (Live)', 'Noches de Prueba (Remix)', 'Noches de Prueba (Acoustic)']) {
      const s = scoreLyricsCandidate(wanted, {
        providerId: 'x', externalId: '1', trackName: name, artistName: 'Artista Ficticio', albumName: 'Álbum',
        durationMs: 200_000, instrumental: false, syncedLrc: '[00:01.00] a',
      });
      expect(matchLevel(s), name).toBe('uncertain');
      expect(s.reasons.join()).toContain('versión distinta');
    }
  });
});

describe('títulos de YouTube con marketing (videos con letra)', () => {
  it('"A mí (Letra/Lyrics)" queda como "A mí" para poder reconocerla en el catálogo', () => {
    expect(parseYouTubeTitle('Rels B - A mí (Letra/Lyrics)', 'Glasswing')).toEqual({ artist: 'Rels B', title: 'A mí' });
    expect(parseYouTubeTitle('Rels B - A mí (Letra/ Lyrics) [Official Video]', 'x').title).toBe('A mí');
    expect(parseYouTubeTitle('Artista - Tema [Con letra]', 'x').title).toBe('Tema');
    expect(parseYouTubeTitle('Artista - Tema (Video Oficial) (HD)', 'x').title).toBe('Tema');
  });

  it('no destruye títulos legítimos que contienen paréntesis o la palabra "letra" fuera de ellos', () => {
    expect(parseYouTubeTitle('Artista - Carta (Acoustic)', 'x').title).toBe('Carta (Acoustic)');
    expect(parseYouTubeTitle('Artista - Mi Letra', 'x').title).toBe('Mi Letra');
    expect(parseYouTubeTitle('Artista - Tema (feat. Otro)', 'x').title).toBe('Tema (feat. Otro)');
    expect(stripNoise('Tema (Live at Wembley)')).toContain('Live');
  });
});

describe('obras instrumentales', () => {
  const wanted = { title: 'Clair de lune (moonlight) Debussy Classic lullaby', artist: 'Claude Debussy', durationMs: 384_000 };

  it('consenso: varias grabaciones, todas instrumentales', () => {
    expect(instrumentalConsensus(wanted, [cand(), cand({ durationMs: 340_000 }), cand({ durationMs: 248_000 })])).toBe(true);
  });

  it('una sola grabación no basta, ni mezclar con una que tiene letra', () => {
    expect(instrumentalConsensus(wanted, [cand()])).toBe(false);
    expect(instrumentalConsensus(wanted, [cand(), cand({ instrumental: false, syncedLrc: '[00:01.00] letra' })])).toBe(false);
  });

  it('candidatos de OTRA obra o artista no cuentan', () => {
    expect(instrumentalConsensus(wanted, [cand({ trackName: 'Otra cosa' }), cand({ trackName: 'Nada que ver' })])).toBe(false);
    expect(instrumentalConsensus(wanted, [cand({ artistName: 'Otro Artista' }), cand({ artistName: 'Otro Artista' })])).toBe(false);
  });

  it('LyricsService: se declara INSTRUMENTAL aunque la duración no permita saber qué versión suena', () => {
    TestBed.configureTestingModule({});
    const r = TestBed.inject(LyricsService).evaluate('t', wanted, [cand(), cand({ durationMs: 340_000 })]);
    expect(r.status).toBe('INSTRUMENTAL');
    expect(r.lyrics).toBeUndefined();
    expect(r.message).toContain('instrumental');
  });

  it('si el usuario eligió una versión concreta se respeta su elección', () => {
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(LyricsService);
    const r = svc.evaluate('t', wanted, [cand({ externalId: 'a' }), cand({ externalId: 'b' })], 'a');
    expect(r.status).toBe('INSTRUMENTAL'); // la elegida también es instrumental
  });
});

describe('LRCLIB prueba variantes del título', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('si el título completo no da resultados, reintenta sin paréntesis', async () => {
    fetchMock.mockImplementation((url: string) => {
      const name = new URL(url).searchParams.get('track_name');
      const body = name === 'Clair de lune Debussy Classic lullaby' ? [{ id: 1, trackName: 'Clair de Lune', artistName: 'Claude Debussy', instrumental: true, duration: 216 }] : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    const out = await new LrclibProvider().find({ title: 'Clair de lune (moonlight) Debussy Classic lullaby', artist: 'Claude Debussy' });
    expect(out.map((c) => c.externalId)).toEqual(['1']);
    const names = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get('track_name'));
    expect(names[0]).toBe('Clair de lune (moonlight) Debussy Classic lullaby'); // primero el título fiel
    expect(names).toContain('Clair de lune Debussy Classic lullaby');
  });

  it('titlePrefixes: del prefijo más largo al más corto, mínimo 2 palabras, máximo 3 variantes', () => {
    expect(titlePrefixes('Clair de lune Debussy Classic lullaby')).toEqual(['Clair de lune Debussy', 'Clair de lune', 'Clair de']);
    expect(titlePrefixes('Dos palabras')).toEqual([]); // ya es lo más corto útil
    expect(titlePrefixes('Una')).toEqual([]);
    expect(titlePrefixes('Tres palabras aquí')).toEqual(['Tres palabras']);
  });

  it('con el título aún ruidoso, prueba prefijos hasta encontrar la obra y se detiene', async () => {
    const instrumentals = [1, 2, 3].map((id) => ({ id, trackName: 'Clair de Lune', artistName: 'Claude Debussy', instrumental: true, duration: 200 + id }));
    fetchMock.mockImplementation((url: string) => {
      const name = new URL(url).searchParams.get('track_name');
      return Promise.resolve(new Response(JSON.stringify(name === 'Clair de lune' ? instrumentals : []), { status: 200 }));
    });
    const out = await new LrclibProvider().find({ title: 'Clair de lune (moonlight) Debussy Classic lullaby', artist: 'Claude Debussy' });
    expect(out).toHaveLength(3);
    const names = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get('track_name'));
    expect(names).toContain('Clair de lune');
    expect(names).not.toContain('Clair de'); // se detuvo al tener suficientes
  });

  it('si el título ya es simple no repite consultas inútiles', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })));
    await new LrclibProvider().find({ title: 'Simple', artist: 'Artista' });
    const structured = fetchMock.mock.calls.map((c) => new URL(c[0] as string)).filter((u) => u.searchParams.has('track_name'));
    expect(structured).toHaveLength(1);
  });
});

describe('orden de resultados del catálogo', () => {
  const t = (id: string, title: string, album?: string): Track => ({ id, source: 'itunes', title, artist: 'A', album, providerLabel: 'x' });

  it('las versiones que no pediste van después de la normal (orden estable)', () => {
    const list = [t('1', 'Blinding Lights (Remix)'), t('2', 'Blinding Lights'), t('3', 'Blinding Lights (Live)'), t('4', 'Blinding Lights (Chromatics Remix)')];
    expect(rankPlainFirst(list, 'The Weeknd Blinding Lights').map((x) => x.id)).toEqual(['2', '1', '3', '4']);
  });

  it('si pediste la versión, no se penaliza', () => {
    const list = [t('1', 'Tema (Remix)'), t('2', 'Tema')];
    // pediste el remix: ninguna se penaliza y el orden original se conserva
    expect(rankPlainFirst(list, 'Tema remix').map((x) => x.id)).toEqual(['1', '2']);
  });

  it('sin variantes en la lista, el orden no cambia', () => {
    const list = [t('1', 'Uno'), t('2', 'Dos'), t('3', 'Tres')];
    expect(rankPlainFirst(list, 'algo').map((x) => x.id)).toEqual(['1', '2', '3']);
  });
});
