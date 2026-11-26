import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverArtProvider } from './cover-art.provider';
import { isMbid, luceneQuote, MusicBrainzProvider, pickRecording, pickRelease } from './musicbrainz.provider';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }));

const A = '24f4415e-2684-42ed-b002-807066381839';
const B = 'c400ecc6-74a5-47ba-a96a-0f0cdf454642';
const RG = '9b905cac-df8d-4942-bc4e-4fe0f2ed635f';

const release = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  score: 100,
  title: 'Canción de Prueba',
  status: 'Official',
  date: '2019-11-29',
  'release-group': { id: RG, 'primary-type': 'Single' },
  ...over,
});

describe('utilidades', () => {
  it('isMbid valida UUID y rechaza todo lo demás (los ids van en rutas)', () => {
    expect(isMbid(A)).toBe(true);
    for (const bad of ['', 'abc', '../x', `${A}/../../etc`, A + 'x', 42, null, undefined, '<img>']) expect(isMbid(bad)).toBe(false);
  });

  it('luceneQuote escapa comillas y barras (no se puede inyectar sintaxis en la consulta)', () => {
    expect(luceneQuote('A Mí')).toBe('"A Mí"');
    expect(luceneQuote('Dijo "hola"')).toBe('"Dijo \\"hola\\""');
    expect(luceneQuote('a\\b')).toBe('"a\\\\b"');
    expect(luceneQuote('  muchos    espacios ')).toBe('"muchos espacios"');
    expect(luceneQuote('x" OR artist:"y')).toBe('"x\\" OR artist:\\"y"');
  });
});

describe('pickRelease', () => {
  it('descarta puntuaciones bajas, ids inválidos y registros incompletos', () => {
    expect(pickRelease([release(A, { score: 70 }), release('no-es-uuid'), { id: B, score: 100 }])).toBeNull();
    expect(pickRelease([])).toBeNull();
  });

  it('entre empates prefiere álbum, luego sencillo, y el más antiguo', () => {
    const got = pickRelease([
      release(A, { 'release-group': { id: RG, 'primary-type': 'Single' }, date: '2019-01-01' }),
      release(B, { 'release-group': { id: RG, 'primary-type': 'Album' }, date: '2020-03-20' }),
    ]);
    expect(got?.releaseId).toBe(B);
    const older = pickRelease([release(A, { date: '2021-01-01' }), release(B, { date: '2019-05-05' })]);
    expect(older?.releaseId).toBe(B);
  });

  it('ignora un release-group con id no válido', () => {
    const got = pickRelease([release(A, { 'release-group': { id: '../x', 'primary-type': 'Album' } })]);
    expect(got?.releaseId).toBe(A);
    expect(got?.releaseGroupId).toBeUndefined();
  });
});

describe('pickRecording', () => {
  it('prefiere la que tiene ISRC y duración, y descarta baja puntuación', () => {
    const got = pickRecording([
      { id: A, score: 100, title: 'x' },
      { id: B, score: 100, title: 'x', isrcs: ['USUMV2403154'], length: 200_000 },
      { id: A, score: 60, isrcs: ['XX'] },
    ]);
    expect(got).toEqual({ id: B, isrc: 'USUMV2403154', lengthMs: 200_000 });
    expect(pickRecording([{ id: A, score: 50 }])).toBeNull();
  });
});

describe('MusicBrainzProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('busca el LANZAMIENTO por grabación y artista (la búsqueda por grabación no trae álbum)', async () => {
    fetchMock.mockImplementation(() => json({ releases: [release(A), release(B, { 'release-group': { id: RG, 'primary-type': 'Album' } })] }));
    const m = await new MusicBrainzProvider().findRelease('Blinding Lights', 'The Weeknd');
    expect(m).toEqual({ releaseId: B, releaseGroupId: RG, title: 'Canción de Prueba', date: '2019-11-29' });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://musicbrainz.org/ws/2/release/');
    expect(url.searchParams.get('fmt')).toBe('json');
    const q = url.searchParams.get('query')!;
    expect(q).toContain('recording:"Blinding Lights"');
    expect(q).toContain('artist:"The Weeknd"');
    expect(q).toContain('status:official');
  });

  it('una consulta con comillas se escapa en la URL enviada', async () => {
    fetchMock.mockImplementation(() => json({ releases: [] }));
    await new MusicBrainzProvider().findRelease('Dijo "hola"', 'Artista');
    const q = new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('query')!;
    expect(q).toContain('recording:"Dijo \\"hola\\""');
  });

  it('sin coincidencia fiable devuelve null', async () => {
    fetchMock.mockImplementation(() => json({ releases: [release(A, { score: 40 })] }));
    expect(await new MusicBrainzProvider().findRelease('Nada', 'Nadie')).toBeNull();
  });

  it('respuesta sin la lista de lanzamientos (incompleta) no rompe', async () => {
    fetchMock.mockImplementation(() => json({}));
    expect(await new MusicBrainzProvider().findRelease('X', 'Y')).toBeNull();
  });

  it('reintenta cuando MusicBrainz responde 503 "servidor ocupado"', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockImplementationOnce(() => json({ error: 'The MusicBrainz web server is currently busy.' }, 503, { 'Retry-After': '1' }))
      .mockImplementationOnce(() => json({ releases: [release(A)] }));
    const p = new MusicBrainzProvider().findRelease('Tema', 'Artista');
    await vi.advanceTimersByTimeAsync(1500);
    expect((await p)?.releaseId).toBe(A);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serializa las consultas a 1 por segundo y cachea las repetidas', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => json({ releases: [release(A)] }));
    const mb = new MusicBrainzProvider();
    const t0 = Date.now();
    const stamps: number[] = [];
    fetchMock.mockImplementation(() => {
      stamps.push(Date.now() - t0);
      return json({ releases: [release(A)] });
    });
    const all = Promise.all([mb.findRelease('Uno', 'A'), mb.findRelease('Dos', 'A'), mb.findRelease('Tres', 'A')]);
    await vi.advanceTimersByTimeAsync(4000);
    await all;
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(1100);
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(1100);

    const calls = fetchMock.mock.calls.length;
    await mb.findRelease('uno', 'a'); // misma consulta (sin distinguir mayúsculas)
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('un fallo definitivo se propaga para que quien llama lo trate como opcional', async () => {
    fetchMock.mockImplementation(() => json({}, 500));
    await expect(new MusicBrainzProvider().findRelease('X', 'Y')).rejects.toMatchObject({ code: 'HTTP' });
  });

  it('findRecording devuelve el ISRC cuando existe', async () => {
    fetchMock.mockImplementation(() => json({ recordings: [{ id: A, score: 100, title: 'x', isrcs: ['USUMV2403154'] }] }));
    expect(await new MusicBrainzProvider().findRecording('Blinding Lights', 'The Weeknd')).toMatchObject({ id: A, isrc: 'USUMV2403154' });
  });
});

describe('CoverArtProvider', () => {
  const caa = new CoverArtProvider();
  it('construye la URL de la portada frontal con el tamaño pedido', () => {
    expect(caa.frontUrl('release', A)).toBe(`https://coverartarchive.org/release/${A}/front-500`);
    expect(caa.frontUrl('release-group', RG, 1200)).toBe(`https://coverartarchive.org/release-group/${RG}/front-1200`);
    expect(caa.frontUrl('release', A, 250)).toContain('front-250');
  });

  it('con un identificador no válido NO construye ninguna URL (evita rutas arbitrarias)', () => {
    for (const bad of ['', '../../admin', `${A}/../x`, 'https://evil.com', '<script>']) {
      expect(caa.frontUrl('release', bad)).toBeNull();
    }
  });
});
