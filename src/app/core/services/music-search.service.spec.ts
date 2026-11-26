import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Track } from '../models/music.models';
import { SEARCH_CONFIG } from '../config/app-config';
import { AppError } from '../models/music.models';
import { ItunesProvider } from '../providers/itunes.provider';
import { YouTubeProvider } from '../providers/youtube.provider';
import { MusicSearchService } from './music-search.service';

const track = (id: number, title: string): Track => ({
  id: `itunes:${id}`,
  source: 'itunes',
  title,
  artist: 'Artista Ficticio',
  providerLabel: 'Apple Music',
});

/** Promesa controlable para simular respuestas lentas/rápidas. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('MusicSearchService', () => {
  const search = vi.fn();
  const searchVideos = vi.fn();
  const yt = { hasApiKey: true, searchVideos };
  let svc: MusicSearchService;

  beforeEach(() => {
    vi.useFakeTimers();
    search.mockReset();
    searchVideos.mockReset();
    yt.hasApiKey = true;
    TestBed.configureTestingModule({
      providers: [
        { provide: ItunesProvider, useValue: { search } },
        { provide: YouTubeProvider, useValue: yt },
      ],
    });
    svc = TestBed.inject(MusicSearchService);
  });
  afterEach(() => vi.useRealTimers());

  it('debounce: varias pulsaciones seguidas hacen una sola petición', async () => {
    search.mockResolvedValue([track(1, 'Hola')]);
    for (const q of ['no', 'noc', 'noch', 'noche']) {
      svc.setQuery(q);
      vi.advanceTimersByTime(100);
    }
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SEARCH_CONFIG.debounceMs);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe('noche');
    expect(svc.state()).toBe('results');
  });

  it('una respuesta lenta y antigua no pisa a la más reciente', async () => {
    const slow = deferred<Track[]>();
    search.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([track(2, 'Nueva')]);
    svc.setQuery('vieja', { immediate: true });
    svc.setQuery('nueva', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.results().map((t) => t.title)).toEqual(['Nueva']);
    slow.resolve([track(1, 'Vieja')]); // llega tarde
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.results().map((t) => t.title)).toEqual(['Nueva']);
  });

  it('cancela la petición anterior con AbortController', async () => {
    let firstSignal: AbortSignal | undefined;
    search.mockImplementationOnce((_q: string, signal: AbortSignal) => {
      firstSignal = signal;
      return new Promise(() => {});
    });
    search.mockResolvedValueOnce([]);
    svc.setQuery('uno', { immediate: true });
    svc.setQuery('dos', { immediate: true });
    expect(firstSignal?.aborted).toBe(true);
  });

  it('consultas muy cortas no buscan', async () => {
    svc.setQuery('ab');
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).not.toHaveBeenCalled();
    expect(svc.state()).toBe('idle');
  });

  it('un enlace no se envía al catálogo', async () => {
    svc.setQuery('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).not.toHaveBeenCalled();
  });

  it('sin resultados → estado empty; fallo → error con mensaje', async () => {
    search.mockResolvedValueOnce([]);
    svc.setQuery('nada', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.state()).toBe('empty');

    search.mockRejectedValueOnce(new Error('boom'));
    svc.setQuery('falla', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.state()).toBe('error');
    expect(svc.error()).toBeTruthy();
  });

  it('el mínimo es el configurado: 2 caracteres no buscan, 3 sí', async () => {
    search.mockResolvedValue([]);
    svc.setQuery('ab');
    await vi.advanceTimersByTimeAsync(SEARCH_CONFIG.debounceMs + 50);
    expect(search).not.toHaveBeenCalled();
    svc.setQuery('abc');
    await vi.advanceTimersByTimeAsync(SEARCH_CONFIG.debounceMs + 50);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('escribir NUNCA consulta YouTube, aunque haya clave (cada búsqueda cuesta cuota)', async () => {
    search.mockResolvedValue([track(1, 'Hola')]);
    for (const q of ['hol', 'hola', 'hola m', 'hola mu']) {
      svc.setQuery(q);
      await vi.advanceTimersByTimeAsync(SEARCH_CONFIG.debounceMs + 50);
    }
    expect(searchVideos).not.toHaveBeenCalled();
  });

  it('la búsqueda en YouTube es explícita y añade los videos tras el catálogo', async () => {
    search.mockResolvedValue([track(1, 'Catálogo')]);
    searchVideos.mockResolvedValue([{ ...track(2, 'Video'), id: 'yt:abcdefghijk', source: 'youtube' }]);
    svc.setQuery('hola mundo', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    await svc.searchYoutube();
    expect(searchVideos).toHaveBeenCalledTimes(1);
    expect(svc.results().map((r) => r.title)).toEqual(['Catálogo', 'Video']);
    expect(svc.videoState()).toBe('done');
  });

  it('cuota agotada: muestra el mensaje y conserva el catálogo', async () => {
    search.mockResolvedValue([track(1, 'Catálogo')]);
    searchVideos.mockRejectedValue(new AppError('YT_QUOTA', 'La cuota gratuita de YouTube se agotó'));
    svc.setQuery('hola mundo', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    await svc.searchYoutube();
    expect(svc.videoState()).toBe('error');
    expect(svc.videoError()).toContain('cuota');
    expect(svc.results().map((r) => r.title)).toEqual(['Catálogo']);
  });

  it('sin clave la búsqueda en YouTube no llama a la API y explica qué falta', async () => {
    yt.hasApiKey = false;
    search.mockResolvedValue([]);
    svc.setQuery('hola mundo', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    await svc.searchYoutube();
    expect(searchVideos).not.toHaveBeenCalled();
    expect(svc.videoError()).toContain('clave');
  });

  it('una segunda pulsación mientras busca no lanza otra petición', async () => {
    search.mockResolvedValue([]);
    const slow = deferred<Track[]>();
    searchVideos.mockReturnValue(slow.promise);
    svc.setQuery('hola mundo', { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    void svc.searchYoutube();
    void svc.searchYoutube();
    expect(searchVideos).toHaveBeenCalledTimes(1);
    slow.resolve([]);
  });

  it('reset limpia todo y cancela pendientes', async () => {
    search.mockResolvedValue([track(1, 'Hola')]);
    svc.setQuery('hola');
    svc.reset();
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).not.toHaveBeenCalled();
    expect(svc.query()).toBe('');
  });
});
