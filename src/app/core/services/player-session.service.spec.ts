import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LyricsCandidate } from '../models/lyrics.models';
import { Track } from '../models/music.models';
import { ItunesProvider } from '../providers/itunes.provider';
import { LYRICS_PROVIDERS } from '../providers/lyrics-provider';
import { YouTubeProvider } from '../providers/youtube.provider';
import { ArtworkResolverService } from './artwork-resolver.service';
import { ColorExtractionService } from './color-extraction.service';
import { fallbackPalette } from './palette';
import { PlayerSessionService } from './player-session.service';
import { SettingsService } from './settings.service';

const track = (id: string, title: string): Track => ({
  id: `itunes:${id}`,
  source: 'itunes',
  title,
  artist: 'Artista Ficticio',
  album: 'Álbum Ficticio',
  durationMs: 180_000,
  providerLabel: 'Apple Music',
});
const lyricsFor = (t: Track): LyricsCandidate => ({
  providerId: 'fake',
  externalId: `l-${t.title}`,
  trackName: t.title,
  artistName: t.artist,
  albumName: t.album,
  durationMs: 180_000,
  instrumental: false,
  syncedLrc: `[00:05.00] letra de ${t.title}`,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PlayerSessionService', () => {
  const lookup = vi.fn();
  const getVideoInfo = vi.fn();
  const bestMatch = vi.fn();
  const needsEnrichment = vi.fn();
  const enrich = vi.fn();
  let session: PlayerSessionService;
  let settings: SettingsService;

  beforeEach(() => {
    localStorage.clear();
    lookup.mockReset();
    getVideoInfo.mockReset();
    bestMatch.mockReset();
    needsEnrichment.mockReset().mockReturnValue(false);
    enrich.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: ItunesProvider, useValue: { lookup, search: vi.fn(), bestMatch } },
        {
          provide: YouTubeProvider,
          useValue: { hasApiKey: false, getVideoInfo, findVideoFor: vi.fn() },
        },
        { provide: ColorExtractionService, useValue: { paletteFor: async (_u: unknown, seed: string) => fallbackPalette(seed) } },
        { provide: ArtworkResolverService, useValue: { needsEnrichment, enrich } },
        {
          provide: LYRICS_PROVIDERS,
          useValue: [
            {
              id: 'fake',
              label: 'fake',
              find: async (q: { title: string; artist: string }) => [
                lyricsFor({ ...track('0', q.title), artist: q.artist }),
              ],
            },
          ],
        },
      ],
    });
    session = TestBed.inject(PlayerSessionService);
    settings = TestBed.inject(SettingsService);
  });

  it('abre una canción: metadatos, letras y modo demostración sin clave de YouTube', async () => {
    lookup.mockResolvedValue(track('1', 'Primera'));
    await session.open('itunes:1');
    expect(session.uiState()).toBe('PLAYER_READY');
    expect(session.track()?.title).toBe('Primera');
    expect(session.source()?.kind).toBe('demo');
    expect(session.sourceNote()).toContain('YouTube');
    expect(session.lyricsStatus()).toBe('FOUND_SYNCED');
    expect(session.lyrics()?.lines.some((l) => l.text === 'letra de Primera')).toBe(true);
  });

  it('cambio rápido de canción: la respuesta tardía de la anterior se ignora', async () => {
    const slowA = deferred<Track>();
    lookup.mockImplementation((id: string) => (id === '1' ? slowA.promise : Promise.resolve(track('2', 'Segunda'))));

    const first = session.open('itunes:1');
    await session.open('itunes:2');
    expect(session.track()?.title).toBe('Segunda');

    slowA.resolve(track('1', 'Primera')); // llega tarde
    await first;
    expect(session.track()?.title).toBe('Segunda');
    expect(session.lyrics()?.lines.some((l) => l.text.includes('Primera'))).toBe(false);
    expect(session.uiState()).toBe('PLAYER_READY');
  });

  it('un identificador inválido muestra un error claro y no consulta nada', async () => {
    await session.open('javascript:alert(1)');
    expect(session.uiState()).toBe('PLAYER_ERROR');
    expect(session.errorMessage()).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('un fallo de red lleva a PLAYER_ERROR con mensaje comprensible', async () => {
    lookup.mockRejectedValue(new Error('network'));
    await session.open('itunes:9');
    expect(session.uiState()).toBe('PLAYER_ERROR');
    expect(session.errorMessage()).not.toContain('network');
  });

  it('el ajuste de sincronía se limita, se guarda por canción/versión y se recupera', async () => {
    lookup.mockResolvedValue(track('1', 'Primera'));
    await session.open('itunes:1');
    session.nudgeOffset(200);
    session.nudgeOffset(100);
    expect(session.offsetMs()).toBe(300);
    session.setOffset(999_999);
    expect(session.offsetMs()).toBe(10_000);
    session.setOffset(-999_999);
    expect(session.offsetMs()).toBe(-10_000);
    session.setOffset(250);
    session.close();

    await session.open('itunes:1'); // reabrir la misma canción recupera el ajuste
    expect(session.offsetMs()).toBe(250);

    lookup.mockResolvedValue(track('2', 'Segunda'));
    await session.open('itunes:2'); // otra canción empieza en 0
    expect(session.offsetMs()).toBe(0);
    session.setOffset(0);
    expect(settings.getOffset('itunes:1|demo')).toBe(250);
  });

  const ytInfo = {
    videoId: 'dQw4w9WgXcQ',
    title: 'Artista - Canción (Official Video)',
    channel: 'Artista',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    artist: 'Artista',
    trackTitle: 'Canción',
  };

  it('enlace de YouTube sin coincidencia en el catálogo: se completa con MusicBrainz y Cover Art Archive', async () => {
    getVideoInfo.mockResolvedValue(ytInfo);
    bestMatch.mockResolvedValue(null);
    needsEnrichment.mockReturnValue(true);
    enrich.mockResolvedValue({ album: 'Álbum Real', artworkUrl: 'https://coverartarchive.org/x/front-1200', metadataSource: 'musicbrainz' });

    await session.open('yt:dQw4w9WgXcQ');
    await vi.waitFor(() => expect(session.track()?.album).toBe('Álbum Real'));
    expect(session.track()?.artworkUrl).toContain('coverartarchive');
    expect(session.track()?.videoId).toBe('dQw4w9WgXcQ'); // el id de YouTube se conserva aparte
    expect(session.uiState()).toBe('PLAYER_READY'); // el complemento no bloqueó nada
  });

  it('si MusicBrainz falla, la canción se abre igual con lo que dio YouTube', async () => {
    getVideoInfo.mockResolvedValue(ytInfo);
    bestMatch.mockResolvedValue(null);
    needsEnrichment.mockReturnValue(true);
    enrich.mockRejectedValue(new Error('503'));
    await session.open('yt:dQw4w9WgXcQ');
    expect(session.uiState()).toBe('PLAYER_READY');
    expect(session.track()?.title).toBe('Canción');
    expect(session.track()?.artworkUrl).toBe(ytInfo.thumbnailUrl);
  });

  it('si el catálogo principal ya dio portada NO se consultan proveedores alternativos', async () => {
    lookup.mockResolvedValue(track('1', 'Primera'));
    await session.open('itunes:1');
    expect(enrich).not.toHaveBeenCalled();
  });

  it('un complemento tardío de la canción anterior no pisa a la actual', async () => {
    const slow = deferred<Record<string, string>>();
    getVideoInfo.mockResolvedValue(ytInfo);
    bestMatch.mockResolvedValue(null);
    needsEnrichment.mockReturnValue(true);
    enrich.mockReturnValue(slow.promise);
    await session.open('yt:dQw4w9WgXcQ');

    lookup.mockResolvedValue(track('2', 'Segunda'));
    needsEnrichment.mockReturnValue(false);
    await session.open('itunes:2');
    slow.resolve({ album: 'Álbum de la canción vieja' });
    await new Promise((r) => setTimeout(r, 20));
    expect(session.track()?.title).toBe('Segunda');
    expect(session.track()?.album).not.toBe('Álbum de la canción vieja');
  });

  it('valida los enlaces de video pegados', () => {
    expect(session.parseVideoInput('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(() => session.parseVideoInput('https://example.com/x')).toThrow();
  });

  it('close() deja la sesión limpia', async () => {
    lookup.mockResolvedValue(track('1', 'Primera'));
    await session.open('itunes:1');
    session.close();
    expect(session.track()).toBeNull();
    expect(session.uiState()).toBe('HOME');
    expect(session.lyricsStatus()).toBe('IDLE');
  });
});
