import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Track } from '../models/music.models';
import { CoverArtProvider } from '../providers/cover-art.provider';
import { MusicBrainzProvider } from '../providers/musicbrainz.provider';
import { ArtworkResolverService } from './artwork-resolver.service';

const REL = '24f4415e-2684-42ed-b002-807066381839';
const RG = '9b905cac-df8d-4942-bc4e-4fe0f2ed635f';

/** Image simulada: carga bien salvo las URL que contienen cualquiera de `failing`. */
let failing: string[] = [];
class FakeImage {
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) {
    queueMicrotask(() => (failing.some((f) => v.includes(f)) ? this.onerror?.() : this.onload?.()));
  }
}

const yt = (over: Partial<Track> = {}): Track => ({
  id: 'yt:dQw4w9WgXcQ',
  source: 'youtube',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  artworkUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
  providerLabel: 'YouTube',
  metadataSource: 'youtube',
  ...over,
});

describe('ArtworkResolverService', () => {
  const findRelease = vi.fn();
  const findRecording = vi.fn();
  let svc: ArtworkResolverService;

  beforeEach(() => {
    failing = [];
    findRelease.mockReset().mockResolvedValue({ releaseId: REL, releaseGroupId: RG, title: 'After Hours', date: '2020-03-20' });
    findRecording.mockReset().mockResolvedValue({ id: 'ffffffff-2684-42ed-b002-807066381839', isrc: 'USUMV2403154', lengthMs: 200_000 });
    vi.stubGlobal('Image', FakeImage);
    TestBed.configureTestingModule({
      providers: [{ provide: MusicBrainzProvider, useValue: { findRelease, findRecording } }, CoverArtProvider],
    });
    svc = TestBed.inject(ArtworkResolverService);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('solo hace falta complementar si no hay portada o los metadatos vienen de YouTube', () => {
    expect(svc.needsEnrichment(yt())).toBe(true);
    expect(svc.needsEnrichment(yt({ artworkUrl: undefined, metadataSource: 'itunes' }))).toBe(true);
    expect(svc.needsEnrichment(yt({ metadataSource: 'itunes' }))).toBe(false); // catálogo principal con portada: no se consulta más
  });

  it('usa la portada del grupo de lanzamientos y completa álbum, año, ids e ISRC', async () => {
    const extra = await svc.enrich(yt());
    expect(extra).toMatchObject({
      album: 'After Hours',
      year: 2020,
      releaseId: REL,
      releaseGroupId: RG,
      isrc: 'USUMV2403154',
      metadataSource: 'musicbrainz',
      artworkUrl: `https://coverartarchive.org/release-group/${RG}/front-1200`,
      artworkThumbUrl: `https://coverartarchive.org/release-group/${RG}/front-250`,
      artworkFallbackUrl: `https://coverartarchive.org/release-group/${RG}/front-500`,
    });
  });

  it('si no existe la miniatura de 1200 px usa la de 500 (portadas pequeñas)', async () => {
    failing = ['front-1200'];
    const extra = await svc.enrich(yt());
    expect(extra?.artworkUrl).toBe(`https://coverartarchive.org/release-group/${RG}/front-500`);
    expect(extra?.artworkFallbackUrl).toBe(`https://coverartarchive.org/release-group/${RG}/front-500`);
  });

  it('si el grupo no tiene portada prueba el lanzamiento', async () => {
    failing = ['release-group'];
    const extra = await svc.enrich(yt());
    expect(extra?.artworkUrl).toBe(`https://coverartarchive.org/release/${REL}/front-1200`);
  });

  it('si ninguna portada carga (404 o CORS) conserva los metadatos pero NO toca la portada actual', async () => {
    failing = ['coverartarchive'];
    const extra = await svc.enrich(yt());
    expect(extra?.album).toBe('After Hours');
    expect(extra?.artworkUrl).toBeUndefined(); // la miniatura de YouTube sigue siendo el respaldo
  });

  it('sin coincidencia en MusicBrainz no devuelve nada', async () => {
    findRelease.mockResolvedValue(null);
    expect(await svc.enrich(yt())).toBeNull();
    expect(findRecording).not.toHaveBeenCalled();
  });

  it('MusicBrainz caído (503, red) no es un error: devuelve null', async () => {
    findRelease.mockRejectedValue(new Error('503'));
    expect(await svc.enrich(yt())).toBeNull();
  });

  it('si falla solo la búsqueda de grabación, igualmente entrega álbum y portada', async () => {
    findRecording.mockRejectedValue(new Error('503'));
    const extra = await svc.enrich(yt());
    expect(extra?.album).toBe('After Hours');
    expect(extra?.artworkUrl).toBeDefined();
    expect(extra?.isrc).toBeUndefined();
  });

  it('no sobrescribe el álbum ni la duración que la pista ya tenía', async () => {
    const extra = await svc.enrich(yt({ album: 'Álbum propio', durationMs: 123_000 }));
    expect(extra?.album).toBe('Álbum propio');
    expect(extra?.durationMs).toBe(123_000);
  });

  it('la cancelación se propaga', async () => {
    findRelease.mockRejectedValue(new DOMException('x', 'AbortError'));
    await expect(svc.enrich(yt())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
