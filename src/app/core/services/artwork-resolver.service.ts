import { inject, Injectable } from '@angular/core';
import { Track } from '../models/music.models';
import { CoverArtProvider } from '../providers/cover-art.provider';
import { isAbort } from '../providers/http';
import { MusicBrainzProvider } from '../providers/musicbrainz.provider';

/**
 * Complementa una pista con MusicBrainz + Cover Art Archive CUANDO el catálogo principal no dio una
 * portada fiable (p. ej. un enlace de YouTube sin coincidencia en iTunes). No se llama si ya hay
 * información suficiente: así se evitan consultas redundantes y se respeta el límite de MusicBrainz.
 * Todo es opcional: cualquier fallo devuelve null y la reproducción sigue con lo que hubiera.
 */
@Injectable({ providedIn: 'root' })
export class ArtworkResolverService {
  private readonly mb = inject(MusicBrainzProvider);
  private readonly caa = inject(CoverArtProvider);

  /** ¿Merece la pena consultar proveedores alternativos para esta pista? */
  needsEnrichment(track: Track): boolean {
    return !track.artworkUrl || track.metadataSource === 'youtube';
  }

  async enrich(track: Track, signal?: AbortSignal): Promise<Partial<Track> | null> {
    try {
      const release = await this.mb.findRelease(track.title, track.artist, signal);
      if (!release) return null;

      const extra: Partial<Track> = {
        album: track.album ?? release.title,
        releaseId: release.releaseId,
        releaseGroupId: release.releaseGroupId,
        releaseDate: release.date,
        year: Number(release.date?.slice(0, 4)) || track.year,
        metadataSource: 'musicbrainz',
      };

      // Se prueba primero el grupo de lanzamientos (más probable que tenga portada) y luego el
      // lanzamiento; en cada uno, 1200 px y si no existe esa miniatura, 500 px.
      const targets: ['release' | 'release-group', string][] = [];
      if (release.releaseGroupId) targets.push(['release-group', release.releaseGroupId]);
      targets.push(['release', release.releaseId]);
      search: for (const [kind, mbid] of targets) {
        for (const size of [1200, 500] as const) {
          const url = this.caa.frontUrl(kind, mbid, size);
          if (url && (await probeImage(url))) {
            extra.artworkUrl = url;
            extra.artworkThumbUrl = this.caa.frontUrl(kind, mbid, 250) ?? url;
            extra.artworkFallbackUrl = this.caa.frontUrl(kind, mbid, 500) ?? url;
            break search;
          }
        }
      }

      // Identificación adicional (ISRC), solo si hace falta y sin bloquear lo anterior.
      try {
        const rec = await this.mb.findRecording(track.title, track.artist, signal);
        if (rec) {
          extra.musicBrainzId = rec.id;
          extra.isrc = rec.isrc;
          extra.durationMs = track.durationMs ?? rec.lengthMs;
        }
      } catch (e) {
        if (isAbort(e)) throw e;
      }
      return extra;
    } catch (e) {
      if (isAbort(e)) throw e;
      return null; // MusicBrainz es un complemento: no debe impedir nada
    }
  }
}

/** true si la imagen carga Y permite leer sus píxeles (CORS), requisito para extraer colores. */
export function probeImage(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (ok: boolean) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    img.crossOrigin = 'anonymous';
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
}
