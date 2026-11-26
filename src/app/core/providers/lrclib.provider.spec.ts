import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../models/music.models';
import { LrclibProvider } from './lrclib.provider';

// Registros ficticios con la misma forma que devuelve LRCLIB.
const rec = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  trackName: 'Noches de Prueba',
  artistName: 'Artista Ficticio',
  albumName: 'Álbum Ficticio',
  duration: 180,
  instrumental: false,
  hasWordSync: false,
  plainLyrics: 'hola',
  syncedLyrics: '[00:01.00] hola',
  lyricsfile: null,
  ...extra,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('LrclibProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const query = { title: 'Noches de Prueba', artist: 'Artista Ficticio', album: 'Álbum Ficticio', durationMs: 180_000 };

  it('combina búsqueda y consulta exacta, sin duplicados', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('/api/get?') ? json(rec(1)) : json([rec(1), rec(2, { duration: 183 })]),
    );
    const out = await new LrclibProvider().find(query);
    expect(out.map((c) => c.externalId).sort()).toEqual(['1', '2']);
    expect(out[0].durationMs).toBeGreaterThan(0);
    // La consulta exacta envía la duración en segundos.
    const getUrl = fetchMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('/api/get?'))!;
    expect(new URL(getUrl).searchParams.get('duration')).toBe('180');
  });

  it('un 404 en la consulta exacta no es un error si la búsqueda responde', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('/api/get?') ? json({ message: 'no' }, 404) : json([rec(7)]),
    );
    const out = await new LrclibProvider().find({ ...query, title: 'Otra distinta' });
    expect(out).toHaveLength(1);
  });

  it('mapea la sincronía por palabra solo si hay hasWordSync y archivo', async () => {
    fetchMock.mockImplementation(() =>
      json([rec(1, { hasWordSync: true, lyricsfile: 'lines: []' }), rec(2, { hasWordSync: true, lyricsfile: null })]),
    );
    const out = await new LrclibProvider().find({ ...query, durationMs: undefined, title: 'Palabras' });
    expect(out.find((c) => c.externalId === '1')?.wordSyncedFile).toBe('lines: []');
    expect(out.find((c) => c.externalId === '2')?.wordSyncedFile).toBeUndefined();
  });

  it('descarta registros inválidos', async () => {
    fetchMock.mockImplementation(() => json([rec(1), { nada: true }, null]));
    const out = await new LrclibProvider().find({ ...query, durationMs: undefined, title: 'Raros' });
    expect(out).toHaveLength(1);
  });

  it('si todo falla, informa con un mensaje comprensible', async () => {
    fetchMock.mockImplementation(() => json({}, 500));
    await expect(new LrclibProvider().find({ ...query, title: 'Caído' })).rejects.toBeInstanceOf(AppError);
  });

  it('cachea: la misma consulta no vuelve a la red', async () => {
    fetchMock.mockImplementation(() => json([rec(1)]));
    const p = new LrclibProvider();
    const q = { ...query, durationMs: undefined, title: 'Cache' };
    await p.find(q);
    const calls = fetchMock.mock.calls.length;
    await p.find(q);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('getById: lee GET /api/get/{id} y mapea el registro', async () => {
    fetchMock.mockImplementation(() => json(rec(42)));
    const c = await new LrclibProvider().getById(42);
    expect(c?.externalId).toBe('42');
    expect(fetchMock.mock.calls[0][0]).toBe('https://lrclib.net/api/get/42');
  });

  it('getById: un 404 devuelve null y un id no numérico ni siquiera consulta la red', async () => {
    fetchMock.mockImplementation(() => json({ message: 'no' }, 404));
    const p = new LrclibProvider();
    expect(await p.getById(7)).toBeNull();
    fetchMock.mockClear();
    expect(await p.getById('../admin')).toBeNull();
    expect(await p.getById('12;DROP')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin resultados estructurados prueba la búsqueda libre (q)', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('q=') ? json([rec(5)]) : json([]),
    );
    const out = await new LrclibProvider().find({ ...query, durationMs: undefined, title: 'Rara' });
    expect(out.map((c) => c.externalId)).toEqual(['5']);
    expect(fetchMock.mock.calls.map((c) => c[0] as string).some((u) => u.includes('q=Artista'))).toBe(true);
  });

  it('un registro con campos nulos no rompe el mapeo (respuestas incompletas)', async () => {
    fetchMock.mockImplementation(() =>
      json([{ id: 9, trackName: 'X', artistName: 'Y', albumName: null, duration: null, instrumental: null, syncedLyrics: null, plainLyrics: null }]),
    );
    const [c] = await new LrclibProvider().find({ ...query, durationMs: undefined, title: 'Nulos' });
    expect(c.albumName).toBeUndefined();
    expect(c.durationMs).toBeUndefined();
    expect(c.instrumental).toBe(false);
    expect(c.syncedLrc).toBeUndefined();
  });

  it('propaga la cancelación', async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
    );
    const pending = new LrclibProvider().find({ ...query, durationMs: undefined, title: 'Lento' }, ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
