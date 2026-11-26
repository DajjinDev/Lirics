import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../services/settings.service';
import { mapYouTubeError, YouTubeProvider } from './youtube.provider';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const googleError = (code: number, reason: string, message = '') => ({ error: { code, message, errors: [{ reason }] } });

const video = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: 'Artista Ficticio - Canción de Prueba (Official Video)',
    channelTitle: 'ArtistaFicticioVEVO',
    thumbnails: { default: { url: 'd.jpg' }, medium: { url: 'm.jpg' }, high: { url: 'h.jpg' } },
  },
  contentDetails: { duration: 'PT3M45S' },
  status: { embeddable: true },
  ...over,
});

const ID1 = 'aaaaaaaaaaa';
const ID2 = 'bbbbbbbbbbb';
const ID3 = 'ccccccccccc';

describe('mapYouTubeError', () => {
  it('distingue cuota, clave inválida, API deshabilitada y restricciones por su motivo', () => {
    expect(mapYouTubeError(403, googleError(403, 'quotaExceeded'))?.code).toBe('YT_QUOTA');
    expect(mapYouTubeError(403, googleError(403, 'dailyLimitExceeded'))?.code).toBe('YT_QUOTA');
    expect(mapYouTubeError(400, googleError(400, 'badRequest', 'API key not valid. Please pass a valid API key.'))?.code).toBe('YT_KEY_INVALID');
    expect(mapYouTubeError(403, googleError(403, 'accessNotConfigured'))?.code).toBe('YT_API_DISABLED');
    expect(mapYouTubeError(403, googleError(403, 'ipRefererBlocked', 'Requests from referer <empty> are blocked.'))?.code).toBe('YT_KEY_RESTRICTED');
    expect(mapYouTubeError(403, googleError(403, 'forbidden'))?.code).toBe('YT_FORBIDDEN');
  });

  it('CUERPO REAL de Google para una clave inválida (capturado con una petición real)', () => {
    const real = {
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        errors: [{ message: 'API key not valid. Please pass a valid API key.', domain: 'global', reason: 'badRequest' }],
        status: 'INVALID_ARGUMENT',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
      },
    };
    expect(mapYouTubeError(400, real)?.code).toBe('YT_KEY_INVALID');
  });

  it('los mensajes son accionables y no exponen códigos ni la clave', () => {
    const e = mapYouTubeError(403, googleError(403, 'quotaExceeded'))!;
    expect(e.userMessage).toContain('cuota');
    expect(e.userMessage).not.toMatch(/403|quotaExceeded/);
  });

  it('un error que no reconoce devuelve null (cae al manejo genérico)', () => {
    expect(mapYouTubeError(500, { algo: 1 })).toBeNull();
    expect(mapYouTubeError(404, null)).toBeNull();
    expect(mapYouTubeError(500, 'texto')).toBeNull();
  });
});

describe('YouTubeProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let yt: YouTubeProvider;
  let settings: SettingsService;
  const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
    settings = TestBed.inject(SettingsService);
    yt = TestBed.inject(YouTubeProvider);
  });
  afterEach(() => vi.unstubAllGlobals());

  const withKey = () => settings.update('youtubeApiKey', 'CLAVE-FICTICIA');

  /* ----------------------------- búsqueda ----------------------------- */

  describe('searchVideos', () => {
    function mockSearch() {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/search?')) return json({ items: [{ id: { videoId: ID1 } }, { id: { videoId: ID2 } }, { id: { videoId: ID3 } }, { id: {} }, { id: { videoId: '../hack' } }] });
        if (url.includes('/videos?')) {
          return json({
            items: [
              video(ID1),
              video(ID2, { status: { embeddable: false } }),
              video(ID3, { contentDetails: { duration: 'PT10M' }, snippet: { title: 'Solo título', channelTitle: 'Un Canal - Topic', thumbnails: {} } }),
            ],
          });
        }
        return json({}, 404);
      });
    }

    it('sin clave no llama a la API y explica qué falta', async () => {
      await expect(yt.searchVideos('hola mundo')).rejects.toMatchObject({ code: 'YT_NO_KEY' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('una consulta corta no consume cuota', async () => {
      withKey();
      expect(await yt.searchVideos('ab')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hace UNA búsqueda y UNA llamada agrupada de detalles; solo videos insertables', async () => {
      withKey();
      mockSearch();
      const tracks = await yt.searchVideos('Artista Ficticio Canción');
      expect(urls().filter((u) => u.includes('/search?'))).toHaveLength(1);
      expect(urls().filter((u) => u.includes('/videos?'))).toHaveLength(1);

      const search = new URL(urls().find((u) => u.includes('/search?'))!);
      expect(search.searchParams.get('type')).toBe('video');
      expect(search.searchParams.get('videoEmbeddable')).toBe('true');
      expect(search.searchParams.get('maxResults')).toBe('10');
      expect(search.searchParams.get('part')).toBe('snippet');
      // los detalles piden los ids válidos en un solo `id=a,b,c` (los inválidos se descartan)
      expect(new URL(urls().find((u) => u.includes('/videos?'))!).searchParams.get('id')).toBe(`${ID1},${ID2},${ID3}`);

      expect(tracks.map((t) => t.videoId)).toEqual([ID1, ID3]); // el no insertable se excluye
      expect(tracks[0]).toMatchObject({
        id: `yt:${ID1}`,
        source: 'youtube',
        title: 'Canción de Prueba',
        artist: 'Artista Ficticio',
        durationMs: 225_000,
        providerLabel: 'YouTube',
      });
      expect(tracks[1]).toMatchObject({ title: 'Solo título', artist: 'Un Canal', durationMs: 600_000 });
    });

    it('los resultados nunca contienen la clave', async () => {
      withKey();
      mockSearch();
      const tracks = await yt.searchVideos('Artista Ficticio Canción');
      expect(JSON.stringify(tracks)).not.toContain('CLAVE-FICTICIA');
    });

    it('la misma búsqueda se sirve de la caché (sin gastar cuota)', async () => {
      withKey();
      mockSearch();
      await yt.searchVideos('Artista Ficticio Canción');
      const calls = fetchMock.mock.calls.length;
      await yt.searchVideos('  artista ficticio canción ');
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('dos búsquedas simultáneas iguales comparten una sola petición', async () => {
      withKey();
      mockSearch();
      await Promise.all([yt.searchVideos('Misma consulta'), yt.searchVideos('misma consulta')]);
      expect(urls().filter((u) => u.includes('/search?'))).toHaveLength(1);
    });

    it('sin resultados no pide detalles', async () => {
      withKey();
      fetchMock.mockImplementation(() => json({ items: [] }));
      expect(await yt.searchVideos('nada de nada')).toEqual([]);
      expect(urls()).toHaveLength(1);
    });

    it('respuestas incompletas (campos ausentes) no rompen el mapeo', async () => {
      withKey();
      fetchMock.mockImplementation((url: string) =>
        url.includes('/search?') ? json({ items: [{ id: { videoId: ID1 } }] }) : json({ items: [{ id: ID1 }] }),
      );
      const [t] = await yt.searchVideos('respuesta vacía');
      expect(t.videoId).toBe(ID1);
      expect(t.durationMs).toBeUndefined();
    });

    it('cuota agotada → error claro; la clave inválida también', async () => {
      withKey();
      fetchMock.mockImplementationOnce(() => json(googleError(403, 'quotaExceeded'), 403));
      await expect(yt.searchVideos('consulta uno')).rejects.toMatchObject({ code: 'YT_QUOTA' });
      fetchMock.mockImplementationOnce(() => json(googleError(400, 'badRequest', 'API key not valid. Please pass a valid API key.'), 400));
      await expect(yt.searchVideos('consulta dos')).rejects.toMatchObject({ code: 'YT_KEY_INVALID' });
    });

    it('un fallo no se cachea: se puede reintentar', async () => {
      withKey();
      fetchMock.mockImplementationOnce(() => json(googleError(403, 'quotaExceeded'), 403));
      await expect(yt.searchVideos('reintento')).rejects.toBeDefined();
      mockSearch();
      expect((await yt.searchVideos('reintento')).length).toBeGreaterThan(0);
    });

    it('excluye videos bloqueados en la región del usuario', async () => {
      withKey();
      settings.update('country', 'CO');
      fetchMock.mockImplementation((url: string) =>
        url.includes('/search?')
          ? json({ items: [{ id: { videoId: ID1 } }, { id: { videoId: ID2 } }] })
          : json({ items: [video(ID1, { contentDetails: { duration: 'PT3M', regionRestriction: { blocked: ['CO'] } } }), video(ID2)] }),
      );
      expect((await yt.searchVideos('restricciones región')).map((t) => t.videoId)).toEqual([ID2]);
    });
  });

  /* ----------------------- información de un video ----------------------- */

  describe('getVideoInfo', () => {
    it('con clave usa videos.list (1 llamada) y entrega duración e inserción', async () => {
      withKey();
      fetchMock.mockImplementation(() => json({ items: [video(ID1)] }));
      const info = await yt.getVideoInfo(ID1);
      expect(info).toMatchObject({ videoId: ID1, durationMs: 225_000, embeddable: true, artist: 'Artista Ficticio', trackTitle: 'Canción de Prueba' });
      expect(urls()).toHaveLength(1);
      const u = new URL(urls()[0]);
      expect(u.pathname).toContain('/youtube/v3/videos');
      expect(u.searchParams.get('part')).toBe('snippet,contentDetails,status');
      expect(u.searchParams.get('id')).toBe(ID1);
    });

    it('sin clave usa oEmbed (sin cuota) y no inventa la duración', async () => {
      fetchMock.mockImplementation(() => json({ title: 'Artista - Tema (Official Audio)', author_name: 'Artista - Topic', thumbnail_url: 't.jpg' }));
      const info = await yt.getVideoInfo(ID1);
      expect(urls()[0]).toContain('youtube.com/oembed');
      expect(info).toMatchObject({ artist: 'Artista', trackTitle: 'Tema', channel: 'Artista' });
      expect(info.durationMs).toBeUndefined();
    });

    it('el video no insertable se detecta antes de intentar reproducirlo', async () => {
      withKey();
      fetchMock.mockImplementation(() => json({ items: [video(ID1, { status: { embeddable: false } })] }));
      await expect(yt.getVideoInfo(ID1)).rejects.toMatchObject({ code: 'NOT_EMBEDDABLE' });
    });

    it('un video inexistente o privado (lista vacía) da un mensaje claro', async () => {
      withKey();
      fetchMock.mockImplementation(() => json({ items: [] }));
      await expect(yt.getVideoInfo(ID1)).rejects.toMatchObject({ code: 'VIDEO_UNAVAILABLE' });
    });

    it('restricción regional: bloqueado o fuera de la lista permitida', async () => {
      withKey();
      settings.update('country', 'CO');
      fetchMock.mockImplementationOnce(() => json({ items: [video(ID1, { contentDetails: { duration: 'PT3M', regionRestriction: { blocked: ['CO', 'US'] } } })] }));
      await expect(yt.getVideoInfo(ID1)).rejects.toMatchObject({ code: 'REGION_BLOCKED' });
      fetchMock.mockImplementationOnce(() => json({ items: [video(ID2, { contentDetails: { duration: 'PT3M', regionRestriction: { allowed: ['JP'] } } })] }));
      await expect(yt.getVideoInfo(ID2)).rejects.toMatchObject({ code: 'REGION_BLOCKED' });
      fetchMock.mockImplementationOnce(() => json({ items: [video(ID3, { contentDetails: { duration: 'PT3M', regionRestriction: { allowed: ['CO'] } } })] }));
      await expect(yt.getVideoInfo(ID3)).resolves.toBeDefined();
    });

    it('si la clave falla (cuota, inválida…) recurre a oEmbed: un enlace pegado sigue funcionando', async () => {
      withKey();
      fetchMock.mockImplementation((url: string) =>
        url.includes('oembed') ? json({ title: 'A - B', author_name: 'A', thumbnail_url: 't.jpg' }) : json(googleError(403, 'quotaExceeded'), 403),
      );
      const info = await yt.getVideoInfo(ID1);
      expect(info.trackTitle).toBe('B');
    });

    it('rechaza identificadores con forma inválida sin consultar la red', async () => {
      withKey();
      for (const bad of ['', 'corto', '../../etc/passwd', 'a'.repeat(12), '<script>alert']) {
        await expect(yt.getVideoInfo(bad)).rejects.toMatchObject({ code: 'INVALID_ID' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cachea la información de un video', async () => {
      withKey();
      fetchMock.mockImplementation(() => json({ items: [video(ID1)] }));
      await yt.getVideoInfo(ID1);
      await yt.getVideoInfo(ID1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  /* ------------------------ elegir el video de una canción ------------------------ */

  describe('findVideoFor', () => {
    it('sin clave devuelve null sin consultar nada', async () => {
      expect(await yt.findVideoFor({ title: 'T', artist: 'A' }, 'k')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('elige la mejor versión (audio de estudio) y descarta covers', async () => {
      withKey();
      fetchMock.mockImplementation((url: string) =>
        url.includes('/search?')
          ? json({ items: [{ id: { videoId: ID1 } }, { id: { videoId: ID2 } }] })
          : json({
              items: [
                video(ID1, { snippet: { title: 'Canción de Prueba - Piano Cover', channelTitle: 'Pianista', thumbnails: {} }, contentDetails: { duration: 'PT3M20S' } }),
                video(ID2, { snippet: { title: 'Canción de Prueba', channelTitle: 'Artista Ficticio - Topic', thumbnails: {} }, contentDetails: { duration: 'PT3M20S' } }),
              ],
            }),
      );
      const id = await yt.findVideoFor({ title: 'Canción de Prueba', artist: 'Artista Ficticio', durationMs: 200_000 }, 'k1');
      expect(id).toBe(ID2);
    });

    it('ningún resultado fiable → null (nunca adivina)', async () => {
      withKey();
      fetchMock.mockImplementation((url: string) =>
        url.includes('/search?')
          ? json({ items: [{ id: { videoId: ID1 } }] })
          : json({ items: [video(ID1, { snippet: { title: 'Receta de pasta', channelTitle: 'Cocina', thumbnails: {} } })] }),
      );
      expect(await yt.findVideoFor({ title: 'Canción de Prueba', artist: 'Artista Ficticio' }, 'k2')).toBeNull();
    });
  });
});
