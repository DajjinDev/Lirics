import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { OFFSET_CONFIG } from '../config/app-config';
import { stripFeaturing, stripNoise, parseYouTubeUrl } from '../lyrics/text-normalize';
import { matchLevel, WantedTrack } from '../lyrics/track-matcher';
import {
  LyricsCandidate,
  LyricsStatus,
  ScoredLyricsCandidate,
  SyncedLyrics,
} from '../models/lyrics.models';
import { AppError, PlaybackSource, Track, UiState } from '../models/music.models';
import { isAbort } from '../providers/http';
import { ItunesProvider } from '../providers/itunes.provider';
import { YouTubeProvider } from '../providers/youtube.provider';
import { ArtworkResolverService } from './artwork-resolver.service';
import { ColorExtractionService } from './color-extraction.service';
import { DynamicThemeService } from './dynamic-theme.service';
import { HistoryService } from './history.service';
import { LyricsService } from './lyrics.service';
import { PlaybackService } from './playback.service';
import { SettingsService } from './settings.service';

const TRACK_ID = /^(itunes:\d{1,15}|yt:[A-Za-z0-9_-]{11})$/;
export const MAX_OFFSET_MS = OFFSET_CONFIG.maxMs;

/**
 * Sesión de la canción abierta: une metadatos, fuente de reproducción y
 * letras. Cada `open()` invalida al anterior (identificador de ejecución +
 * AbortController), de modo que una respuesta tardía de la canción previa
 * jamás pisa a la actual.
 */
@Injectable({ providedIn: 'root' })
export class PlayerSessionService {
  private readonly itunes = inject(ItunesProvider);
  private readonly youtube = inject(YouTubeProvider);
  private readonly lyricsSvc = inject(LyricsService);
  private readonly colors = inject(ColorExtractionService);
  private readonly artwork = inject(ArtworkResolverService);
  private readonly theme = inject(DynamicThemeService);
  private readonly history = inject(HistoryService);
  private readonly settings = inject(SettingsService);
  private readonly playback = inject(PlaybackService);

  readonly track = signal<Track | null>(null);
  readonly uiState = signal<UiState>('HOME');
  readonly loadingStep = signal('');
  readonly errorMessage = signal<string | null>(null);

  readonly source = signal<PlaybackSource | null>(null);
  /** Texto informativo sobre qué se reproduce (canal, modo demostración…). */
  readonly sourceNote = signal<string | null>(null);

  readonly lyricsStatus = signal<LyricsStatus>('IDLE');
  readonly lyrics = signal<SyncedLyrics | null>(null);
  readonly plainLyrics = signal<string | null>(null);
  readonly lyricsMessage = signal<string | null>(null);
  readonly alternatives = signal<ScoredLyricsCandidate[]>([]);
  readonly bestMatch = signal<ScoredLyricsCandidate | null>(null);
  readonly lyricsProvider = computed(() => this.lyrics()?.source ?? null);

  /** Convención: positivo = letras más tarde, negativo = más temprano. */
  readonly offsetMs = signal(0);

  readonly matchLevel = computed(() => {
    const b = this.bestMatch();
    return b ? matchLevel(b) : null;
  });

  private runId = 0;
  private abort: AbortController | null = null;
  private candidates: LyricsCandidate[] = [];
  private chosenId: string | undefined;
  private currentVideoOverride: string | undefined;

  constructor() {
    // Cuando el reproductor revela la duración real, se reevalúa la coincidencia de letras.
    effect(() => {
      this.playback.durationMs();
      this.playback.sourceKind();
      untracked(() => this.reevaluateLyrics());
    });
  }

  /** Valida un enlace pegado. Lanza AppError con un mensaje claro si no sirve. */
  parseVideoInput(input: string): string {
    const id = parseYouTubeUrl(input);
    if (!id) {
      throw new AppError('INVALID_URL', 'Ese enlace no parece un video de YouTube. Pega una URL como https://www.youtube.com/watch?v=…');
    }
    return id;
  }

  async open(trackId: string, videoOverride?: string): Promise<void> {
    if (!TRACK_ID.test(trackId)) {
      this.fail(new AppError('INVALID_ID', 'El enlace de la canción no es válido.'));
      return;
    }
    const alreadyOpen =
      this.track()?.id === trackId &&
      this.currentVideoOverride === videoOverride &&
      (this.uiState() === 'PLAYER_READY' || this.uiState() === 'PLAYER_LOADING');
    if (alreadyOpen) return;

    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const run = ++this.runId;
    const live = () => run === this.runId && !ac.signal.aborted;

    this.currentVideoOverride = videoOverride;
    this.resetLyrics();
    this.source.set(null);
    this.sourceNote.set(null);
    this.errorMessage.set(null);
    this.playback.stop();
    this.uiState.set('PLAYER_LOADING');

    try {
      this.loadingStep.set('Buscando información de la canción…');
      const track = await this.resolveTrack(trackId, videoOverride, ac.signal);
      if (!live()) return;
      this.track.set(track);
      this.history.addTrack(track);
      void this.applyPalette(track, live);
      // Sin portada fiable del catálogo principal: se intenta MusicBrainz + Cover Art Archive (en segundo plano).
      if (this.artwork.needsEnrichment(track)) void this.enrichTrack(track, live, ac.signal);

      // Letras y fuente de reproducción en paralelo: ninguna espera a la otra.
      const lyricsDone = this.loadLyrics(track, live, ac.signal);
      this.loadingStep.set('Preparando la reproducción…');
      const src = await this.resolveSource(track, videoOverride, ac.signal);
      if (!live()) return;
      this.source.set(src);
      this.offsetMs.set(this.settings.getOffset(this.versionKey()));
      this.uiState.set('PLAYER_READY');
      await lyricsDone;
    } catch (e) {
      if (!live() || isAbort(e)) return;
      this.fail(e);
    }
  }

  /** Elige manualmente otra versión de letras de la lista de alternativas. */
  chooseLyrics(externalId: string): void {
    this.chosenId = externalId;
    this.reevaluateLyrics(true);
  }

  setOffset(ms: number): void {
    const v = Math.max(OFFSET_CONFIG.minMs, Math.min(OFFSET_CONFIG.maxMs, Math.round(ms)));
    this.offsetMs.set(v);
    this.settings.saveOffset(this.versionKey(), v);
  }
  nudgeOffset(deltaMs: number): void {
    this.setOffset(this.offsetMs() + deltaMs);
  }

  /** Libera todo al salir del reproductor. */
  close(): void {
    this.runId++;
    this.abort?.abort();
    this.playback.stop();
    this.track.set(null);
    this.source.set(null);
    this.resetLyrics();
    this.uiState.set('HOME');
    this.theme.reset();
  }

  /* ----------------------------- internos ----------------------------- */

  private versionKey(): string {
    const src = this.source();
    return `${this.track()?.id ?? 'none'}|${src?.kind === 'youtube' ? src.videoId : 'demo'}`;
  }

  private resetLyrics(): void {
    this.candidates = [];
    this.chosenId = undefined;
    this.lyricsStatus.set('IDLE');
    this.lyrics.set(null);
    this.plainLyrics.set(null);
    this.lyricsMessage.set(null);
    this.alternatives.set([]);
    this.bestMatch.set(null);
    this.offsetMs.set(0);
  }

  private async resolveTrack(trackId: string, videoOverride: string | undefined, signal: AbortSignal): Promise<Track> {
    const [kind, id] = trackId.split(':') as ['itunes' | 'yt', string];
    if (kind === 'itunes') {
      const t = await this.itunes.lookup(id, signal);
      return videoOverride ? { ...t, videoId: videoOverride } : t;
    }
    // Enlace de YouTube: se enriquece con el catálogo para obtener portada oficial y duración.
    const info = await this.youtube.getVideoInfo(id, signal);
    const match = await this.itunes.bestMatch(info.trackTitle, info.artist, signal).catch((e) => {
      if (isAbort(e)) throw e;
      return null; // el catálogo es un complemento: sin él seguimos con lo que dio YouTube
    });
    if (match) return { ...match, id: trackId, videoId: id };
    return {
      id: trackId,
      source: 'youtube',
      title: info.trackTitle,
      artist: info.artist,
      artworkUrl: info.thumbnailUrl,
      artworkThumbUrl: info.thumbnailUrl,
      videoId: id,
      providerLabel: 'YouTube',
    };
  }

  private async resolveSource(track: Track, videoOverride: string | undefined, signal: AbortSignal): Promise<PlaybackSource> {
    const vid = videoOverride ?? track.videoId;
    if (vid) {
      const info = await this.youtube.getVideoInfo(vid, signal);
      this.sourceNote.set(`Reproduciendo desde YouTube · ${info.channel}`);
      return { kind: 'youtube', videoId: vid, title: info.title, channel: info.channel };
    }

    if (this.youtube.hasApiKey) {
      try {
        const found = await this.youtube.findVideoFor(this.wanted(track), track.id, signal);
        if (found) {
          const info = await this.youtube.getVideoInfo(found, signal);
          this.sourceNote.set(`Reproduciendo desde YouTube · ${info.channel}`);
          return { kind: 'youtube', videoId: found, title: info.title, channel: info.channel };
        }
        this.sourceNote.set('No encontramos un video fiable de esta canción en YouTube. Pega el enlace de la versión que quieres.');
      } catch (e) {
        if (isAbort(e)) throw e;
        this.sourceNote.set(e instanceof AppError ? e.userMessage : 'No se pudo buscar el video en YouTube.');
      }
    } else {
      this.sourceNote.set('Pega el enlace de YouTube de esta canción para escucharla con su letra (o añade tu clave de YouTube en Personalizar para buscarla automáticamente).');
    }
    return { kind: 'demo' };
  }

  private wanted(track: Track, durationMs = track.durationMs): WantedTrack {
    return {
      title: stripFeaturing(stripNoise(track.title)) || track.title,
      artist: track.artist,
      album: track.album,
      durationMs,
    };
  }

  /** Duración de la grabación que realmente suena, si el reproductor la conoce. */
  private referenceDuration(track: Track): number | undefined {
    const d = this.playback.durationMs();
    return this.playback.sourceKind() === 'youtube' && d > 0 ? d : track.durationMs;
  }

  private async loadLyrics(track: Track, live: () => boolean, signal: AbortSignal): Promise<void> {
    this.lyricsStatus.set('SEARCHING');
    try {
      const candidates = await this.lyricsSvc.fetchCandidates(this.wanted(track), signal);
      if (!live()) return;
      this.candidates = candidates;
      this.reevaluateLyrics(true);
    } catch (e) {
      if (!live() || isAbort(e)) return;
      this.lyricsStatus.set('ERROR');
      this.lyricsMessage.set(
        e instanceof AppError ? e.userMessage : 'No pudimos consultar las letras en este momento.',
      );
    }
  }

  /**
   * Recalcula qué letras corresponden a la grabación actual. Si no cambia ni
   * la mejor opción ni el estado, no toca nada para evitar parpadeos.
   */
  private reevaluateLyrics(force = false): void {
    const track = this.track();
    if (!track) return;
    if (this.candidates.length === 0) {
      // Solo se declara "no encontradas" cuando la búsqueda ya terminó (force).
      if (force && this.lyricsStatus() === 'SEARCHING') {
        this.lyricsStatus.set('NOT_FOUND');
        this.lyricsMessage.set('No encontramos letras para esta canción.');
      }
      return;
    }
    const res = this.lyricsSvc.evaluate(
      track.id,
      this.wanted(track, this.referenceDuration(track)),
      this.candidates,
      this.chosenId,
    );
    const prevId = this.bestMatch()?.candidate.externalId;
    const sameBest = prevId !== undefined && prevId === res.best?.candidate.externalId;
    if (!force && sameBest && this.lyricsStatus() === res.status) {
      this.bestMatch.set(res.best ?? null); // actualiza la confianza sin recrear las letras
      return;
    }

    this.alternatives.set(res.alternatives);
    this.bestMatch.set(res.best ?? null);
    this.lyrics.set(res.lyrics ?? null);
    this.plainLyrics.set(res.plainLyrics ?? null);
    this.lyricsMessage.set(res.message ?? null);
    this.lyricsStatus.set(res.status);
  }

  private async applyPalette(track: Track, live: () => boolean): Promise<void> {
    const p = await this.colors.paletteFor(
      [track.artworkUrl, track.artworkFallbackUrl, track.artworkThumbUrl],
      `${track.title}|${track.artist}`,
    );
    if (live()) this.theme.setPalette(p);
  }

  /** Completa la pista con proveedores alternativos; nunca bloquea ni rompe la reproducción. */
  private async enrichTrack(track: Track, live: () => boolean, signal: AbortSignal): Promise<void> {
    try {
      const extra = await this.artwork.enrich(track, signal);
      if (!extra || !live()) return;
      const merged: Track = { ...track, ...extra };
      this.track.set(merged);
      this.history.addTrack(merged);
      if (extra.artworkUrl) void this.applyPalette(merged, live);
    } catch {
      /* complemento opcional */
    }
  }

  private fail(e: unknown): void {
    this.errorMessage.set(
      e instanceof AppError ? e.userMessage : 'Algo salió mal al abrir la canción. Inténtalo de nuevo.',
    );
    this.uiState.set('PLAYER_ERROR');
    if (!(e instanceof AppError)) console.error(e);
  }
}
