import { Injectable } from '@angular/core';
import { API_BASES, RATE_LIMITS } from '../config/app-config';
import { fetchJson, RateLimiter, TtlCache } from './http';

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Puntuación mínima de MusicBrainz (0–100) para fiarse de una coincidencia. */
const MIN_SCORE = 90;

export const isMbid = (v: unknown): v is string => typeof v === 'string' && MBID.test(v);

/** Escapa lo necesario dentro de una frase entre comillas de la sintaxis Lucene. */
export function luceneQuote(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/\s+/g, ' ').trim()}"`;
}

interface MbRelease {
  id?: string;
  score?: number;
  title?: string;
  date?: string;
  status?: string;
  'release-group'?: { id?: string; 'primary-type'?: string };
}
interface MbRecording {
  id?: string;
  score?: number;
  title?: string;
  length?: number;
  isrcs?: string[];
}

export interface MbReleaseMatch {
  releaseId: string;
  releaseGroupId?: string;
  title: string;
  date?: string;
}
export interface MbRecordingMatch {
  id: string;
  isrc?: string;
  lengthMs?: number;
}

/**
 * MusicBrainz (complementario): identifica la grabación/lanzamiento cuando el catálogo principal
 * no encuentra la canción.
 *
 * Hallazgos de las pruebas reales:
 *  - Responde 503 ("servidor ocupado") con `Retry-After` de forma intermitente → se reintenta.
 *  - Límite de 1 petición/segundo → se serializa con un limitador en el cliente.
 *  - La búsqueda por GRABACIÓN suele no traer lanzamientos ni duración; la búsqueda por LANZAMIENTO
 *    (`release/?query=recording:… AND artist:…`) sí trae los ids que necesita Cover Art Archive.
 *  - CORS abierto (`access-control-allow-origin: *`).
 * LIMITACIÓN: un navegador no puede fijar la cabecera `User-Agent` que MusicBrainz pide para
 * identificar clientes; para un uso a mayor escala debe hacerse desde un backend (ver README).
 */
@Injectable({ providedIn: 'root' })
export class MusicBrainzProvider {
  private readonly limiter = new RateLimiter(RATE_LIMITS.musicBrainz.max, RATE_LIMITS.musicBrainz.windowMs);
  private readonly releaseCache = new TtlCache<MbReleaseMatch | null>(60 * 60_000, 60);
  private readonly recordingCache = new TtlCache<MbRecordingMatch | null>(60 * 60_000, 60);

  /** Mejor lanzamiento oficial que contiene la grabación; null si no hay coincidencia fiable. */
  async findRelease(title: string, artist: string, signal?: AbortSignal): Promise<MbReleaseMatch | null> {
    const key = `${title}|${artist}`.toLowerCase();
    if (this.releaseCache.get(key) !== undefined) return this.releaseCache.get(key) ?? null;

    const query = `recording:${luceneQuote(title)} AND artist:${luceneQuote(artist)} AND status:official`;
    const data = await this.get<{ releases?: MbRelease[] }>(
      `release/?${new URLSearchParams({ query, fmt: 'json', limit: '8' })}`,
      signal,
    );
    const best = pickRelease(data.releases ?? []);
    this.releaseCache.set(key, best);
    return best;
  }

  /** Grabación (con ISRC si existe). Útil para identificar; no garantiza lanzamiento. */
  async findRecording(title: string, artist: string, signal?: AbortSignal): Promise<MbRecordingMatch | null> {
    const key = `${title}|${artist}`.toLowerCase();
    if (this.recordingCache.get(key) !== undefined) return this.recordingCache.get(key) ?? null;

    const query = `recording:${luceneQuote(title)} AND artist:${luceneQuote(artist)}`;
    const data = await this.get<{ recordings?: MbRecording[] }>(
      `recording/?${new URLSearchParams({ query, fmt: 'json', limit: '6' })}`,
      signal,
    );
    const best = pickRecording(data.recordings ?? []);
    this.recordingCache.set(key, best);
    return best;
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    await this.limiter.take(signal);
    return fetchJson<T>(`${API_BASES.musicBrainz}/${path}`, { signal, label: 'MusicBrainz', retries: 2 });
  }
}

/** Mayor puntuación; a igualdad, álbum antes que sencillo antes que el resto, y el más antiguo. */
export function pickRelease(releases: MbRelease[]): MbReleaseMatch | null {
  const typeRank = (t?: string) => (t === 'Album' ? 0 : t === 'Single' ? 1 : t === 'EP' ? 2 : 3);
  const ok = releases
    .filter((r) => isMbid(r.id) && typeof r.title === 'string' && (r.score ?? 0) >= MIN_SCORE)
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        typeRank(a['release-group']?.['primary-type']) - typeRank(b['release-group']?.['primary-type']) ||
        (a.date ?? '9999').localeCompare(b.date ?? '9999'),
    );
  const r = ok[0];
  if (!r) return null;
  const rg = r['release-group']?.id;
  return { releaseId: r.id as string, releaseGroupId: isMbid(rg) ? rg : undefined, title: r.title as string, date: r.date };
}

/** Prefiere la grabación con ISRC y duración conocida entre las de máxima puntuación. */
export function pickRecording(recs: MbRecording[]): MbRecordingMatch | null {
  const ok = recs
    .filter((r) => isMbid(r.id) && (r.score ?? 0) >= MIN_SCORE)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(!!b.isrcs?.length) - Number(!!a.isrcs?.length) || Number(!!b.length) - Number(!!a.length));
  const r = ok[0];
  if (!r) return null;
  return { id: r.id as string, isrc: r.isrcs?.[0], lengthMs: r.length && r.length > 0 ? r.length : undefined };
}
