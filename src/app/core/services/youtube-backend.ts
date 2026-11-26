import { AppError, PlayerErrorCode, PlayerState } from '../models/music.models';
import { BackendEvents, PlaybackBackend } from './playback-backend';

/* Tipos mínimos de la IFrame Player API (https://developers.google.com/youtube/iframe_api_reference). */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVolume(): number;
  isMuted(): boolean;
  getPlaybackRate(): number;
  stopVideo(): void;
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    cfg: {
      videoId?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
        onPlaybackRateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Carga el script OFICIAL de la IFrame API una sola vez. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => {
      apiPromise = null;
      reject(new AppError('API_LOAD_FAILED', 'No se pudo cargar el reproductor de YouTube. Revisa tu conexión o bloqueadores de contenido.'));
    }, 12_000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      apiPromise = null;
      reject(new AppError('API_LOAD_FAILED', 'No se pudo cargar el reproductor de YouTube. Revisa tu conexión o bloqueadores de contenido.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

const STATE_MAP: Record<number, PlayerState> = {
  [-1]: 'READY',
  0: 'ENDED',
  1: 'PLAYING',
  2: 'PAUSED',
  3: 'BUFFERING',
  5: 'READY',
};

function mapError(code: number): { code: PlayerErrorCode; message: string } {
  switch (code) {
    case 2:
      return { code: 'INVALID_PARAM', message: 'El enlace del video no es válido.' };
    case 100:
      return { code: 'NOT_FOUND', message: 'Ese video fue eliminado o es privado.' };
    case 101:
    case 150:
      return {
        code: 'NOT_EMBEDDABLE',
        message: 'El propietario del video no permite reproducirlo fuera de YouTube. Prueba con otra versión.',
      };
    case 153:
      return { code: 'UNKNOWN', message: 'YouTube rechazó la configuración del reproductor (falta el origen de la página).' };
    default:
      return { code: 'UNKNOWN', message: 'YouTube no pudo reproducir este video.' };
  }
}

/**
 * Reproduce un video autorizado para inserción mediante la IFrame Player
 * API. El reproductor permanece VISIBLE (requisito de las políticas de
 * YouTube); la app solo lo controla y lee su reloj.
 */
export class YouTubeBackend implements PlaybackBackend {
  readonly kind = 'youtube' as const;
  private player: YTPlayer | null = null;
  private destroyed = false;
  private ready = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: BackendEvents,
  ) {}

  async load(opts: { videoId?: string }): Promise<void> {
    if (!opts.videoId) throw new AppError('INVALID_PARAM', 'Falta el identificador del video.');
    this.events.state('LOADING');
    const YT = await loadYouTubeApi();
    if (this.destroyed) return;

    if (this.player && this.ready) {
      this.player.loadVideoById(opts.videoId);
      return;
    }
    await new Promise<void>((resolve) => {
      const mount = document.createElement('div');
      this.host.replaceChildren(mount);
      this.player = new YT.Player(mount, {
        videoId: opts.videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
          disablekb: 1,
          iv_load_policy: 3,
          enablejsapi: 1,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            this.ready = true;
            this.events.state('READY');
            this.player?.playVideo(); // puede bloquearlo el navegador: la UI ofrece "Reproducir"
            resolve();
          },
          onStateChange: (e) => this.events.state(STATE_MAP[e.data] ?? 'READY'),
          onPlaybackRateChange: (e) => this.events.rate?.(e.data),
          onError: (e) => {
            const m = mapError(e.data);
            this.events.error(m.code, m.message);
          },
        },
      });
    });
  }

  play(): void {
    // Antes de onReady no hace nada: onReady ya intenta reproducir.
    if (this.ready) this.player?.playVideo();
  }
  pause(): void {
    this.player?.pauseVideo();
  }
  seek(ms: number): void {
    this.player?.seekTo(Math.max(0, ms) / 1000, true);
  }
  setVolume(p: number): void {
    this.player?.setVolume(Math.min(100, Math.max(0, p)));
  }
  setMuted(muted: boolean): void {
    if (muted) this.player?.mute();
    else this.player?.unMute();
  }
  getCurrentTimeMs(): number {
    return this.ready ? (this.player?.getCurrentTime() ?? 0) * 1000 : 0;
  }
  getDurationMs(): number {
    return this.ready ? (this.player?.getDuration() ?? 0) * 1000 : 0;
  }
  stop(): void {
    this.player?.stopVideo();
  }
  cue(opts: { videoId?: string }): void {
    if (opts.videoId && this.ready) this.player?.cueVideoById(opts.videoId);
  }
  getVolume(): number {
    return this.ready ? (this.player?.getVolume() ?? 0) : 0;
  }
  isMuted(): boolean {
    return this.ready ? (this.player?.isMuted() ?? false) : false;
  }
  getPlaybackRate(): number {
    return this.ready ? (this.player?.getPlaybackRate() ?? 1) : 1;
  }
  destroy(): void {
    this.destroyed = true;
    try {
      this.player?.destroy();
    } catch {
      /* ya destruido */
    }
    this.player = null;
    this.host.replaceChildren();
  }
}
