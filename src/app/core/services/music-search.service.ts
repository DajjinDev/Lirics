import { computed, inject, Injectable, signal } from '@angular/core';
import { SEARCH_CONFIG } from '../config/app-config';
import { looksLikeUrl } from '../lyrics/text-normalize';
import { AppError, Track } from '../models/music.models';
import { isAbort } from '../providers/http';
import { ItunesProvider } from '../providers/itunes.provider';
import { YouTubeProvider } from '../providers/youtube.provider';

export type SearchState = 'idle' | 'loading' | 'results' | 'empty' | 'error';
export type VideoSearchState = 'idle' | 'loading' | 'done' | 'error';

/**
 * Búsqueda musical.
 *  - Catálogo (iTunes, gratis): automática con debounce y cancelación; una respuesta lenta nunca
 *    sustituye a una más reciente.
 *  - YouTube (Data API, con cuota): SOLO bajo petición explícita (botón o Enter), porque cada
 *    búsqueda consume cuota; nunca se lanza al escribir.
 */
@Injectable({ providedIn: 'root' })
export class MusicSearchService {
  private readonly itunes = inject(ItunesProvider);
  private readonly youtube = inject(YouTubeProvider);

  readonly query = signal('');

  readonly catalog = signal<Track[]>([]);
  readonly state = signal<SearchState>('idle');
  readonly error = signal<string | null>(null);

  readonly videos = signal<Track[]>([]);
  readonly videoState = signal<VideoSearchState>('idle');
  readonly videoError = signal<string | null>(null);

  /** Lista combinada que se muestra: catálogo primero, luego videos de YouTube. */
  readonly results = computed(() => [...this.catalog(), ...this.videos()]);
  readonly queryReady = computed(() => this.isSearchable(this.query()));

  private timer: ReturnType<typeof setTimeout> | null = null;
  private ac: AbortController | null = null;
  private videoAc: AbortController | null = null;
  private seq = 0;
  private videoSeq = 0;

  get hasYoutubeKey(): boolean {
    return this.youtube.hasApiKey;
  }

  private isSearchable(raw: string): boolean {
    const q = raw.trim();
    return q.length >= SEARCH_CONFIG.minimumQueryLength && !looksLikeUrl(q);
  }

  setQuery(raw: string, opts: { immediate?: boolean } = {}): void {
    this.query.set(raw);
    this.cancel();
    this.clearVideos();
    // Un enlace no es una consulta de catálogo: lo gestiona el componente.
    if (!this.isSearchable(raw)) {
      this.catalog.set([]);
      this.state.set('idle');
      this.error.set(null);
      return;
    }
    const q = raw.trim();
    this.state.set('loading');
    if (opts.immediate) void this.run(q);
    else this.timer = setTimeout(() => void this.run(q), SEARCH_CONFIG.debounceMs);
  }

  /** Búsqueda explícita en YouTube (consume cuota). No hace nada sin clave o con consulta corta. */
  async searchYoutube(): Promise<void> {
    const q = this.query().trim();
    if (!this.isSearchable(q) || this.videoState() === 'loading') return;
    if (!this.youtube.hasApiKey) {
      this.videoState.set('error');
      this.videoError.set('Añade tu clave de YouTube Data API en Personalizar para buscar videos.');
      return;
    }
    const my = ++this.videoSeq;
    this.videoAc?.abort();
    const ac = new AbortController();
    this.videoAc = ac;
    this.videoState.set('loading');
    this.videoError.set(null);
    try {
      const tracks = await this.youtube.searchVideos(q, ac.signal);
      if (my !== this.videoSeq) return;
      this.videos.set(tracks);
      this.videoState.set('done');
    } catch (e) {
      if (my !== this.videoSeq || isAbort(e)) return;
      this.videos.set([]);
      this.videoError.set(e instanceof AppError ? e.userMessage : 'No pudimos buscar en YouTube en este momento.');
      this.videoState.set('error');
    }
  }

  /** Cancela cualquier búsqueda pendiente o en curso. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ac?.abort();
    this.ac = null;
    this.seq++;
  }

  reset(): void {
    this.cancel();
    this.clearVideos();
    this.query.set('');
    this.catalog.set([]);
    this.state.set('idle');
    this.error.set(null);
  }

  private clearVideos(): void {
    this.videoSeq++;
    this.videoAc?.abort();
    this.videoAc = null;
    this.videos.set([]);
    this.videoState.set('idle');
    this.videoError.set(null);
  }

  private async run(q: string): Promise<void> {
    const my = ++this.seq;
    this.ac?.abort();
    const ac = new AbortController();
    this.ac = ac;
    try {
      const tracks = await this.itunes.search(q, ac.signal);
      if (my !== this.seq) return;
      this.catalog.set(tracks);
      this.error.set(null);
      this.state.set(tracks.length ? 'results' : 'empty');
    } catch (e) {
      if (my !== this.seq || isAbort(e)) return;
      this.catalog.set([]);
      this.error.set(e instanceof AppError ? e.userMessage : 'No pudimos buscar en este momento.');
      this.state.set('error');
    }
  }
}
