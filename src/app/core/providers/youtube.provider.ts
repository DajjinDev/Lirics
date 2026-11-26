import { inject, Injectable } from '@angular/core';
import { API_BASES, SEARCH_CONFIG } from '../config/app-config';
import { cleanChannelName, parseYouTubeTitle } from '../lyrics/text-normalize';
import { pickBestVideo, VideoCandidate, WantedTrack } from '../lyrics/track-matcher';
import { AppError, Track } from '../models/music.models';
import { cleanCountry, SettingsService } from '../services/settings.service';
import { fetchJson, InFlight, TtlCache } from './http';
import { parseIsoDuration } from './iso-duration';

export { parseIsoDuration } from './iso-duration';

export interface YouTubeVideoInfo {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  /** Artista/título deducidos del título del video. */
  artist: string;
  trackTitle: string;
  /** Solo con clave (videos.list). */
  durationMs?: number;
  embeddable?: boolean;
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

interface Thumbnails {
  [size: string]: { url?: string } | undefined;
}
interface SearchResponse {
  items?: { id?: { videoId?: string } }[];
}
interface VideoItem {
  id?: string;
  snippet?: { title?: string; channelTitle?: string; thumbnails?: Thumbnails };
  contentDetails?: { duration?: string; regionRestriction?: { allowed?: string[]; blocked?: string[] } };
  status?: { embeddable?: boolean };
}
interface VideosResponse {
  items?: VideoItem[];
}
interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Traduce los errores de Google según el MOTIVO que devuelve la API (no solo el código HTTP). */
export function mapYouTubeError(status: number, body: unknown): AppError | null {
  const e = (body as GoogleErrorBody | null)?.error;
  const reason = e?.errors?.[0]?.reason ?? '';
  const message = e?.message ?? '';
  if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) {
    return new AppError(
      'YT_QUOTA',
      'La cuota gratuita de YouTube se agotó por ahora. Puedes pegar el enlace del video o intentarlo más tarde.',
    );
  }
  if (reason === 'keyInvalid' || /api key not valid/i.test(message)) {
    return new AppError('YT_KEY_INVALID', 'La clave de YouTube no es válida. Revísala en Personalizar → YouTube.');
  }
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(message)) {
    return new AppError(
      'YT_API_DISABLED',
      'La YouTube Data API v3 no está habilitada en el proyecto de esa clave. Habilítala en Google Cloud.',
    );
  }
  if (reason === 'ipRefererBlocked' || /referer|referrer/i.test(message)) {
    return new AppError(
      'YT_KEY_RESTRICTED',
      'Las restricciones de la clave bloquean este sitio. Añade http://localhost:4200/* a los referentes permitidos.',
    );
  }
  if (status === 403) {
    return new AppError('YT_FORBIDDEN', 'YouTube no permitió la solicitud con esa clave.');
  }
  return null;
}

/** Elige la miniatura más grande disponible. */
function bestThumb(t?: Thumbnails): string | undefined {
  for (const k of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = t?.[k]?.url;
    if (url) return url;
  }
  return undefined;
}

/**
 * Acceso a YouTube SIN descargar ni extraer audio:
 *  - Sin clave: oEmbed (título, canal, miniatura de un enlace pegado).
 *  - Con clave propia del usuario (Data API v3):
 *      · `videos.list` (≈1 unidad de cuota) para un enlace pegado: duración, inserción, región.
 *      · `search.list` (≈100 unidades) SOLO bajo petición explícita o al abrir una canción; nunca al
 *        escribir. Los detalles de hasta 10 resultados se piden en UNA llamada a `videos.list`.
 *    Los costos de cuota deben confirmarse en la consola de Google Cloud (no se verificaron en vivo).
 */
@Injectable({ providedIn: 'root' })
export class YouTubeProvider {
  private readonly settings = inject(SettingsService);
  private readonly infoCache = new TtlCache<YouTubeVideoInfo>(60 * 60_000, 50);
  private readonly searchCache = new TtlCache<VideoItem[]>(15 * 60_000, 40);
  private readonly resolveCache = new TtlCache<string | null>(24 * 60 * 60_000, 100);
  private readonly inFlight = new InFlight<VideoItem[]>();

  get hasApiKey(): boolean {
    return this.settings.settings().youtubeApiKey.length > 0;
  }

  private key(): string {
    return this.settings.settings().youtubeApiKey;
  }

  /** País del espectador para comprobar restricciones regionales (solo si se conoce). */
  private viewerCountry(): string | null {
    const configured = cleanCountry(this.settings.settings().country);
    if (configured) return configured;
    const region = typeof navigator !== 'undefined' ? /-([A-Za-z]{2})$/.exec(navigator.language)?.[1] : undefined;
    return cleanCountry(region);
  }

  /* ------------------------------------------------------------------ información de un video */

  async getVideoInfo(videoId: string, signal?: AbortSignal): Promise<YouTubeVideoInfo> {
    if (!VIDEO_ID.test(videoId)) throw new AppError('INVALID_ID', 'El identificador del video no es válido.');
    const cached = this.infoCache.get(videoId);
    if (cached) return cached;

    let info: YouTubeVideoInfo | null = null;
    if (this.hasApiKey) {
      try {
        info = await this.infoFromDataApi(videoId, signal);
      } catch (e) {
        // Problemas de clave/cuota no deben impedir reproducir un enlace: se recurre a oEmbed.
        if (!(e instanceof AppError) || !['YT_QUOTA', 'YT_KEY_INVALID', 'YT_API_DISABLED', 'YT_KEY_RESTRICTED', 'YT_FORBIDDEN'].includes(e.code)) {
          throw e;
        }
      }
    }
    info ??= await this.infoFromOEmbed(videoId, signal);
    this.infoCache.set(videoId, info);
    return info;
  }

  private async infoFromDataApi(videoId: string, signal?: AbortSignal): Promise<YouTubeVideoInfo> {
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', id: videoId, key: this.key() });
    const data = await fetchJson<VideosResponse>(`${API_BASES.youtube}/videos?${params}`, {
      signal,
      label: 'YouTube',
      mapError: mapYouTubeError,
    });
    const v = data.items?.[0];
    if (!v) {
      throw new AppError('VIDEO_UNAVAILABLE', 'Ese video no existe, es privado o fue eliminado.');
    }
    if (v.status?.embeddable === false) {
      throw new AppError(
        'NOT_EMBEDDABLE',
        'El propietario de este video no permite reproducirlo fuera de YouTube. Prueba con otra versión.',
      );
    }
    this.assertRegionAllowed(v.contentDetails?.regionRestriction);
    return this.toInfo(videoId, v);
  }

  private assertRegionAllowed(r?: { allowed?: string[]; blocked?: string[] }): void {
    const country = this.viewerCountry();
    if (!r || !country) return;
    if ((r.blocked && r.blocked.includes(country)) || (r.allowed && !r.allowed.includes(country))) {
      throw new AppError('REGION_BLOCKED', 'Este video no está disponible en tu región. Prueba con otra versión.');
    }
  }

  private toInfo(videoId: string, v: VideoItem): YouTubeVideoInfo {
    const title = v.snippet?.title ?? '';
    const channel = v.snippet?.channelTitle ?? '';
    const parsed = parseYouTubeTitle(title, channel);
    return {
      videoId,
      title,
      channel: cleanChannelName(channel),
      thumbnailUrl: bestThumb(v.snippet?.thumbnails) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      artist: parsed.artist,
      trackTitle: parsed.title,
      durationMs: parseIsoDuration(v.contentDetails?.duration),
      embeddable: v.status?.embeddable,
    };
  }

  private async infoFromOEmbed(videoId: string, signal?: AbortSignal): Promise<YouTubeVideoInfo> {
    const url = `https://www.youtube.com/oembed?${new URLSearchParams({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      format: 'json',
    })}`;
    let data: OEmbedResponse;
    try {
      data = await fetchJson<OEmbedResponse>(url, { signal, label: 'YouTube' });
    } catch (e) {
      if (e instanceof AppError && (e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND')) {
        throw new AppError(
          'VIDEO_UNAVAILABLE',
          'Ese video no está disponible o su propietario no permite reproducirlo fuera de YouTube.',
          { cause: e },
        );
      }
      throw e;
    }
    const title = data.title ?? '';
    const parsed = parseYouTubeTitle(title, data.author_name ?? '');
    return {
      videoId,
      title,
      channel: cleanChannelName(data.author_name ?? ''),
      thumbnailUrl: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      artist: parsed.artist,
      trackTitle: parsed.title,
    };
  }

  /* ------------------------------------------------------------------ búsqueda */

  /**
   * Búsqueda EXPLÍCITA de videos (requiere clave). Resultados insertables con duración, como
   * pistas de Liriks. Se cachea 15 min y se deduplican las peticiones idénticas en curso.
   */
  async searchVideos(query: string, signal?: AbortSignal): Promise<Track[]> {
    const items = await this.searchItems(query, signal);
    return items.map((v) => this.itemToTrack(v)).filter((t): t is Track => t !== null);
  }

  private itemToTrack(v: VideoItem): Track | null {
    if (!v.id || !VIDEO_ID.test(v.id)) return null;
    const info = this.toInfo(v.id, v);
    return {
      id: `yt:${v.id}`,
      source: 'youtube',
      title: info.trackTitle || info.title,
      artist: info.artist || info.channel,
      durationMs: info.durationMs,
      videoId: v.id,
      artworkUrl: info.thumbnailUrl,
      artworkThumbUrl: bestThumb({ medium: v.snippet?.thumbnails?.['medium'], default: v.snippet?.thumbnails?.['default'] }) ?? info.thumbnailUrl,
      providerLabel: 'YouTube',
      metadataSource: 'youtube',
    };
  }

  /** search.list + UNA llamada videos.list con todos los ids (duración, inserción, región). */
  private async searchItems(query: string, signal?: AbortSignal): Promise<VideoItem[]> {
    const key = this.key();
    if (!key) throw new AppError('YT_NO_KEY', 'Añade tu clave de YouTube Data API en Personalizar para buscar videos.');
    const q = query.trim();
    if (q.length < SEARCH_CONFIG.minimumQueryLength) return [];

    const cacheKey = q.toLowerCase();
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const items = await this.inFlight.run(cacheKey, async () => {
      // La petición compartida no usa la señal de un solo llamador: si se cancela, el resultado
      // igualmente se cachea y no se paga dos veces por la misma consulta.
      const search = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: String(SEARCH_CONFIG.maxResults),
        q,
        key,
      });
      const found = await fetchJson<SearchResponse>(`${API_BASES.youtube}/search?${search}`, {
        label: 'YouTube',
        mapError: mapYouTubeError,
      });
      const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x && VIDEO_ID.test(x));
      if (ids.length === 0) return [];

      const details = await fetchJson<VideosResponse>(
        `${API_BASES.youtube}/videos?${new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.join(','), key })}`,
        { label: 'YouTube', mapError: mapYouTubeError },
      );
      const country = this.viewerCountry();
      return (details.items ?? []).filter((v) => {
        if (v.status?.embeddable === false) return false;
        const r = v.contentDetails?.regionRestriction;
        if (r && country && ((r.blocked && r.blocked.includes(country)) || (r.allowed && !r.allowed.includes(country)))) return false;
        return true;
      });
    });
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    this.searchCache.set(cacheKey, items);
    return items;
  }

  /**
   * Busca el video más adecuado para una pista del catálogo. Devuelve null si no hay clave o
   * ningún resultado supera el umbral de confianza (nunca adivina).
   */
  async findVideoFor(wanted: WantedTrack, cacheKey: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.hasApiKey) return null;
    const cached = this.resolveCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const items = await this.searchItems(`${wanted.artist} ${wanted.title}`, signal);
    const candidates: VideoCandidate[] = items
      .filter((v): v is VideoItem & { id: string } => !!v.id)
      .map((v) => ({
        videoId: v.id,
        title: v.snippet?.title ?? '',
        channel: v.snippet?.channelTitle ?? '',
        durationMs: parseIsoDuration(v.contentDetails?.duration),
      }));
    const best = pickBestVideo(wanted, candidates);
    this.resolveCache.set(cacheKey, best?.video.videoId ?? null);
    return best?.video.videoId ?? null;
  }
}
