import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS } from '../config/app-config';
import { SettingsService } from '../services/settings.service';
import { artworkAt, ItunesProvider } from './itunes.provider';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const song = (id: number, over: Record<string, unknown> = {}) => ({
  trackId: id,
  artistId: 1,
  collectionId: 2,
  trackName: `Tema ${id}`,
  artistName: 'Artista Ficticio',
  collectionName: 'Álbum Ficticio',
  trackTimeMillis: 200_000,
  releaseDate: '2019-11-29T08:00:00Z',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/abc/cover.jpg/100x100bb.jpg',
  primaryGenreName: 'Pop',
  trackViewUrl: 'https://music.apple.com/x',
  kind: 'song',
  ...over,
});

describe('artworkAt', () => {
  it('cambia el tamaño en la URL y respeta la extensión', () => {
    const u = 'https://x/y/100x100bb.jpg';
    expect(artworkAt(u, 1000)).toBe('https://x/y/1000x1000bb.jpg');
    expect(artworkAt('https://x/y/100x100bb.png', 600)).toBe('https://x/y/600x600bb.png');
    expect(artworkAt(undefined, 600)).toBeUndefined();
  });
  it('si la URL no tiene el patrón esperado la deja intacta', () => {
    expect(artworkAt('https://x/otra-cosa.jpg', 600)).toBe('https://x/otra-cosa.jpg');
  });
});

describe('ItunesProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let it_: ItunesProvider;
  let settings: SettingsService;
  const urls = () => fetchMock.mock.calls.map((c) => new URL(c[0] as string));

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
    settings = TestBed.inject(SettingsService);
    it_ = TestBed.inject(ItunesProvider);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('mapea los campos del catálogo, con portada grande Y la original como alternativa', async () => {
    fetchMock.mockImplementation(() => json({ resultCount: 1, results: [song(7)] }));
    const [t] = await it_.search('tema artista');
    expect(t).toMatchObject({
      id: 'itunes:7',
      source: 'itunes',
      title: 'Tema 7',
      artist: 'Artista Ficticio',
      album: 'Álbum Ficticio',
      durationMs: 200_000,
      year: 2019,
      genre: 'Pop',
      itunesTrackId: 7,
      metadataSource: 'itunes',
    });
    expect(t.artworkUrl).toContain('1000x1000bb');
    expect(t.artworkThumbUrl).toContain('200x200bb');
    // la URL ORIGINAL (documentada) queda como respaldo por si el tamaño grande falla
    expect(t.artworkFallbackUrl).toContain('100x100bb');
  });

  it('el país es configurable y se envía en la consulta', async () => {
    settings.update('country', 'es');
    fetchMock.mockImplementation(() => json({ results: [song(1)] }));
    await it_.search('canción prueba');
    expect(urls()[0].searchParams.get('country')).toBe('ES');
    expect(urls()[0].searchParams.get('entity')).toBe('song');
    expect(urls()[0].searchParams.get('media')).toBe('music');
  });

  it('sin país configurado usa la región del navegador o el predeterminado (nunca queda vacío)', async () => {
    fetchMock.mockImplementation(() => json({ results: [song(1)] }));
    await it_.search('canción prueba');
    expect(urls()[0].searchParams.get('country')).toMatch(/^[A-Z]{2}$/);
  });

  it('un país inválido en ajustes se descarta', () => {
    settings.update('country', 'Colombia');
    expect(settings.settings().country).toBe('');
    settings.update('country', '../');
    expect(settings.settings().country).toBe('');
  });

  it('sin resultados en el catálogo configurado prueba el de EE. UU.', async () => {
    settings.update('country', 'JP');
    fetchMock.mockImplementation((url: string) => (url.includes('country=JP') ? json({ results: [] }) : json({ results: [song(3)] })));
    const out = await it_.search('canción rara');
    expect(out.map((t) => t.id)).toEqual(['itunes:3']);
    expect(urls().map((u) => u.searchParams.get('country'))).toEqual(['JP', 'US']);
  });

  it('si el país configurado ya es EE. UU. no repite la búsqueda', async () => {
    settings.update('country', 'US');
    fetchMock.mockImplementation(() => json({ results: [] }));
    expect(await it_.search('nada por aquí')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('descarta registros incompletos y colapsa duplicados (álbum, deluxe, sencillo)', async () => {
    fetchMock.mockImplementation(() =>
      json({
        results: [
          song(1, { trackName: 'Igual' }),
          song(2, { trackName: 'Igual', collectionName: 'Deluxe' }),
          { trackId: 3 },
          song(4, { trackName: undefined }),
          song(5, { artistName: undefined }),
          song(6, { trackName: 'Otra distinta' }),
        ],
      }),
    );
    expect((await it_.search('prueba duplicados')).map((t) => t.id)).toEqual(['itunes:1', 'itunes:6']);
  });

  it('campos opcionales ausentes no inventan datos', async () => {
    fetchMock.mockImplementation(() => json({ results: [song(1, { trackTimeMillis: undefined, releaseDate: undefined, artworkUrl100: undefined, collectionName: undefined })] }));
    const [t] = await it_.search('sin datos extra');
    expect(t.durationMs).toBeUndefined();
    expect(t.year).toBeUndefined();
    expect(t.artworkUrl).toBeUndefined();
    expect(t.album).toBeUndefined();
  });

  it('una respuesta sin `results` no rompe', async () => {
    fetchMock.mockImplementation(() => json({}));
    expect(await it_.search('respuesta vacía')).toEqual([]);
  });

  it('consultas cortas no llaman a la red', async () => {
    expect(await it_.search('ab')).toEqual([]);
    expect(await it_.search('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cachea resultados repetidos', async () => {
    fetchMock.mockImplementation(() => json({ results: [song(1)] }));
    await it_.search('misma consulta');
    await it_.search('Misma Consulta');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respeta el límite de frecuencia del cliente y lo explica en vez de enviar la petición', async () => {
    fetchMock.mockImplementation(() => json({ results: [song(1)] }));
    for (let i = 0; i < RATE_LIMITS.itunes.max; i++) await it_.search(`consulta número ${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(RATE_LIMITS.itunes.max);
    await expect(it_.search('una más que supera el límite')).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      userMessage: expect.stringContaining('límite'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(RATE_LIMITS.itunes.max); // no se envió
  });

  it('lookup: valida el id y, si no está en el catálogo configurado, prueba el de EE. UU.', async () => {
    await expect(it_.lookup('../x')).rejects.toMatchObject({ code: 'INVALID_ID' });
    expect(fetchMock).not.toHaveBeenCalled();

    settings.update('country', 'JP');
    fetchMock.mockImplementation((url: string) => (url.includes('country=JP') ? json({ results: [] }) : json({ results: [song(55)] })));
    expect((await it_.lookup('55')).id).toBe('itunes:55');
  });

  it('lookup de una canción inexistente da un error claro', async () => {
    fetchMock.mockImplementation(() => json({ results: [] }));
    await expect(it_.lookup('99')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('bestMatch solo acepta el título exacto (nunca una versión parecida)', async () => {
    fetchMock.mockImplementation(() => json({ results: [song(1, { trackName: 'Tema (Remix)' }), song(2, { trackName: 'Tema' })] }));
    expect((await it_.bestMatch('Tema', 'Artista Ficticio'))?.id).toBe('itunes:2');
    fetchMock.mockImplementation(() => json({ results: [song(3, { trackName: 'Otro nombre' })] }));
    expect(await it_.bestMatch('Tema nuevo', 'Artista Ficticio')).toBeNull();
  });
});
