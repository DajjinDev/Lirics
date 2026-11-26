import { Injectable } from '@angular/core';
import { API_BASES } from '../config/app-config';
import { LyricsCandidate } from '../models/lyrics.models';
import { AppError } from '../models/music.models';
import { titlePrefixes, titleVariants } from '../lyrics/text-normalize';
import { WantedTrack } from '../lyrics/track-matcher';
import { fetchJson, TtlCache } from './http';
import { LyricsProvider } from './lyrics-provider';

/** Forma de la respuesta de LRCLIB (verificada contra la API real). */
interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  /** segundos */
  duration?: number | null;
  instrumental?: boolean;
  hasWordSync?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  /** YAML con marcas por palabra; solo si hasWordSync. */
  lyricsfile?: string | null;
}

const BASE = API_BASES.lrclib;

/**
 * LRCLIB: letras sincronizadas colaborativas. Gratuita y sin clave. Sus
 * letras son aportadas por la comunidad y NO implican una licencia
 * comercial: ver docs/ARCHITECTURE.md (sección Licencias) antes de producción.
 */
@Injectable({ providedIn: 'root' })
export class LrclibProvider implements LyricsProvider {
  readonly id = 'lrclib';
  readonly label = 'LRCLIB';
  private readonly cache = new TtlCache<LyricsCandidate[]>(30 * 60_000);

  /** Letras de un registro concreto por su identificador (`GET /api/get/{id}`). null si no existe. */
  async getById(id: string | number, signal?: AbortSignal): Promise<LyricsCandidate | null> {
    if (!/^\d{1,12}$/.test(String(id))) return null; // el id va en la ruta: solo dígitos
    try {
      const rec = await fetchJson<LrclibRecord>(`${BASE}/get/${id}`, { signal, label: 'LRCLIB' });
      return rec && typeof rec.id === 'number' ? toCandidate(rec) : null;
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  }

  async find(query: WantedTrack, signal?: AbortSignal): Promise<LyricsCandidate[]> {
    const key = [query.title, query.artist, query.album ?? '', Math.round((query.durationMs ?? 0) / 1000)]
      .join('|')
      .toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const search = new URLSearchParams({ track_name: query.title, artist_name: query.artist });
    const tasks: Promise<LrclibRecord[]>[] = [
      fetchJson<LrclibRecord[]>(`${BASE}/search?${search}`, { signal, label: 'LRCLIB' }),
    ];
    // Búsqueda exacta por firma (la API exige una duración cercana a la del registro).
    if (query.durationMs) {
      const get = new URLSearchParams({
        track_name: query.title,
        artist_name: query.artist,
        duration: String(Math.round(query.durationMs / 1000)),
      });
      if (query.album) get.set('album_name', query.album);
      tasks.push(
        fetchJson<LrclibRecord>(`${BASE}/get?${get}`, { signal, label: 'LRCLIB' })
          .then((r) => [r])
          .catch((e) => {
            if (e instanceof AppError && e.code === 'NOT_FOUND') return [];
            throw e;
          }),
      );
    }

    const settled = await Promise.allSettled(tasks);
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');

    const records: LrclibRecord[] = [];
    let firstError: unknown;
    for (const s of settled) {
      if (s.status === 'fulfilled') records.push(...s.value);
      else firstError ??= s.reason;
    }
    // Solo es un error si NADA funcionó; un 404 del endpoint exacto es normal.
    if (records.length === 0 && firstError) throw firstError;

    // Sin resultados: se prueban variantes más simples del título (los catálogos añaden ruido como
    // "(moonlight) Classic lullaby") y, al final, la búsqueda libre (`q`).
    if (records.length === 0) {
      for (const variant of titleVariants(query.title).slice(1)) {
        const params = new URLSearchParams({ track_name: variant, artist_name: query.artist });
        const more = await fetchJson<LrclibRecord[]>(`${BASE}/search?${params}`, { signal, label: 'LRCLIB' });
        if (Array.isArray(more) && more.length) {
          records.push(...more);
          break;
        }
      }
    }
    // Pocos resultados: último recurso, prefijos del título (se corta en cuanto hay suficientes).
    if (records.length < 3) {
      for (const prefix of titlePrefixes(query.title)) {
        const params = new URLSearchParams({ track_name: prefix, artist_name: query.artist });
        const more = await fetchJson<LrclibRecord[]>(`${BASE}/search?${params}`, { signal, label: 'LRCLIB' });
        if (Array.isArray(more)) records.push(...more);
        if (records.length >= 3) break;
      }
    }
    if (records.length === 0) {
      const free = new URLSearchParams({ q: `${query.artist} ${titleVariants(query.title).at(-1)}` });
      const more = await fetchJson<LrclibRecord[]>(`${BASE}/search?${free}`, { signal, label: 'LRCLIB' });
      if (Array.isArray(more)) records.push(...more);
    }

    const seen = new Set<number>();
    const out: LyricsCandidate[] = [];
    for (const r of records) {
      if (!r || typeof r.id !== 'number' || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(toCandidate(r));
    }
    this.cache.set(key, out);
    return out;
  }
}

function toCandidate(r: LrclibRecord): LyricsCandidate {
  return {
    providerId: 'lrclib',
    externalId: String(r.id),
    trackName: r.trackName,
    artistName: r.artistName,
    albumName: r.albumName ?? undefined,
    durationMs: r.duration ? Math.round(r.duration * 1000) : undefined,
    instrumental: !!r.instrumental,
    syncedLrc: r.syncedLyrics || undefined,
    wordSyncedFile: r.hasWordSync && r.lyricsfile ? r.lyricsfile : undefined,
    plainLyrics: r.plainLyrics || undefined,
  };
}
