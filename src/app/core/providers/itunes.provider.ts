import { inject, Injectable } from '@angular/core';
import { API_BASES, DEFAULT_COUNTRY, FALLBACK_COUNTRY, RATE_LIMITS, SEARCH_CONFIG } from '../config/app-config';
import { detectVersionFlags, normalizeForCompare } from '../lyrics/text-normalize';
import { AppError, Track } from '../models/music.models';
import { cleanCountry, SettingsService } from '../services/settings.service';
import { fetchJson, RateLimiter, TtlCache } from './http';

/** Campos que se leen de iTunes. Todos pueden faltar: nada se da por supuesto. */
interface ItunesSong {
  trackId?: number;
  artistId?: number;
  collectionId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  trackViewUrl?: string;
  kind?: string;
}
interface ItunesResponse {
  resultCount?: number;
  results?: ItunesSong[];
}

/**
 * Tamaño pedido a la portada. OJO: `artworkUrl100` es lo único que la API documenta; sustituir
 * el tamaño en la URL es una práctica extendida pero NO documentada. Por eso cada pista conserva
 * también la URL original (`artworkFallbackUrl`) y la interfaz recurre a ella si la grande falla.
 */
export function artworkAt(url: string | undefined, size: number): string | undefined {
  return url?.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.$2`);
}

function toTrack(s: ItunesSong): Track | null {
  if (!s.trackId || !s.trackName || !s.artistName) return null; // respuesta incompleta: se descarta
  const year = s.releaseDate ? Number(s.releaseDate.slice(0, 4)) : NaN;
  return {
    id: `itunes:${s.trackId}`,
    source: 'itunes',
    title: s.trackName,
    artist: s.artistName,
    album: s.collectionName,
    durationMs: s.trackTimeMillis && s.trackTimeMillis > 0 ? s.trackTimeMillis : undefined,
    year: Number.isFinite(year) ? year : undefined,
    releaseDate: s.releaseDate,
    genre: s.primaryGenreName,
    itunesTrackId: s.trackId,
    artworkUrl: artworkAt(s.artworkUrl100, 1000),
    artworkThumbUrl: artworkAt(s.artworkUrl100, 200),
    artworkFallbackUrl: s.artworkUrl100,
    providerLabel: 'Apple Music',
    metadataSource: 'itunes',
  };
}

/**
 * iTunes Search API: catálogo, portadas oficiales, duración y género. Sin clave. Se usa SOLO para
 * metadatos (no se reproduce su audio de muestra). Límite histórico ≈ 20 peticiones/min: se aplica
 * un limitador en el cliente con margen.
 */
@Injectable({ providedIn: 'root' })
export class ItunesProvider {
  private readonly settings = inject(SettingsService);
  private readonly limiter = new RateLimiter(RATE_LIMITS.itunes.max, RATE_LIMITS.itunes.windowMs);
  private readonly searchCache = new TtlCache<Track[]>(10 * 60_000, 60);
  private readonly lookupCache = new TtlCache<Track>(60 * 60_000, 60);

  /** País configurado → región del navegador → país por defecto. */
  country(): string {
    const configured = cleanCountry(this.settings.settings().country);
    if (configured) return configured;
    const region =
      typeof navigator !== 'undefined' ? /-([A-Za-z]{2})$/.exec(navigator.language)?.[1] : undefined;
    return cleanCountry(region) ?? DEFAULT_COUNTRY;
  }

  async search(term: string, signal?: AbortSignal, limit: number = SEARCH_CONFIG.maxResults): Promise<Track[]> {
    const q = term.trim();
    if (q.length < SEARCH_CONFIG.minimumQueryLength) return [];

    const primary = this.country();
    let tracks = await this.searchIn(q, primary, limit, signal);
    // Sin resultados en el catálogo configurado: se prueba otro catálogo regional.
    if (tracks.length === 0 && primary !== FALLBACK_COUNTRY) {
      tracks = await this.searchIn(q, FALLBACK_COUNTRY, limit, signal);
    }
    return tracks;
  }

  private async searchIn(q: string, country: string, limit: number, signal?: AbortSignal): Promise<Track[]> {
    const key = `${country}|${limit}|${q.toLowerCase()}`;
    const cached = this.searchCache.get(key);
    if (cached) return cached;
    this.takeSlot();

    const params = new URLSearchParams({
      term: q,
      media: 'music',
      entity: 'song',
      limit: String(Math.min(limit * 2, 50)), // se piden más porque se colapsan duplicados
      country,
    });
    const data = await fetchJson<ItunesResponse>(`${API_BASES.itunes}/search?${params}`, {
      signal,
      label: 'El catálogo musical',
    });
    const tracks = rankPlainFirst(
      dedupe((data.results ?? []).map(toTrack).filter((t): t is Track => t !== null)),
      q,
    ).slice(0, limit);
    this.searchCache.set(key, tracks);
    return tracks;
  }

  async lookup(trackId: string, signal?: AbortSignal): Promise<Track> {
    if (!/^\d{1,15}$/.test(trackId)) throw new AppError('INVALID_ID', 'El identificador de la canción no es válido.');
    const cached = this.lookupCache.get(trackId);
    if (cached) return cached;

    for (const country of new Set([this.country(), FALLBACK_COUNTRY])) {
      this.takeSlot();
      const params = new URLSearchParams({ id: trackId, entity: 'song', country });
      const data = await fetchJson<ItunesResponse>(`${API_BASES.itunes}/lookup?${params}`, {
        signal,
        label: 'El catálogo musical',
      });
      const song = (data.results ?? []).find((r) => String(r.trackId) === trackId);
      const track = song ? toTrack(song) : null;
      if (track) {
        this.lookupCache.set(trackId, track);
        return track;
      }
    }
    throw new AppError('NOT_FOUND', 'No encontramos esa canción en el catálogo.');
  }

  /** Mejor coincidencia del catálogo para un título/artista (p. ej. venido de YouTube). */
  async bestMatch(title: string, artist: string, signal?: AbortSignal): Promise<Track | null> {
    const results = await this.search(`${artist} ${title}`, signal, 6);
    const nt = normalizeForCompare(title);
    return results.find((t) => normalizeForCompare(t.title) === nt) ?? null;
  }

  /** Respeta el límite del proveedor: si se agotó, informa en vez de enviar una petición. */
  private takeSlot(): void {
    const wait = this.limiter.acquire();
    if (wait > 0) {
      throw new AppError(
        'RATE_LIMIT',
        `El catálogo musical alcanzó temporalmente su límite. Reintenta en ${Math.ceil(wait / 1000)} s.`,
      );
    }
  }
}

/**
 * Las versiones alternativas (remix, live, acústica, karaoke…) que el usuario NO pidió van después
 * de la versión normal. El orden relativo dentro de cada grupo se conserva (orden estable).
 */
export function rankPlainFirst(tracks: Track[], query: string): Track[] {
  const asked = detectVersionFlags(query);
  const penalty = (t: Track) =>
    [...detectVersionFlags(`${t.title} ${t.album ?? ''}`)].filter((f) => !asked.has(f)).length;
  return tracks
    .map((t, i) => ({ t, i, p: penalty(t) }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.t);
}

/** iTunes repite la misma canción en álbum, deluxe, single… Se conserva la primera (más relevante). */
function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const k = `${normalizeForCompare(t.title)}|${normalizeForCompare(t.artist)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
