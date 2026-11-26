import { PlayerErrorCode, PlayerState } from '../models/music.models';

/** Eventos que un backend emite hacia PlaybackService. */
export interface BackendEvents {
  state(state: PlayerState): void;
  /** Cambio de velocidad de reproducción (el reloj debe recalibrarse). */
  rate?(rate: number): void;
  error(code: PlayerErrorCode, message: string): void;
}

/**
 * Contrato de un proveedor de reproducción. El reloj del backend es la
 * ÚNICA fuente de verdad del tiempo. Nuevos proveedores (Apple MusicKit,
 * Spotify Web Playback…) implementan esta interfaz sin tocar el motor de
 * letras ni la interfaz.
 */
export interface PlaybackBackend {
  readonly kind: 'youtube' | 'demo' | 'local';
  load(opts: { videoId?: string; url?: string }): Promise<void>;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  setVolume(percent0to100: number): void;
  setMuted(muted: boolean): void;
  getCurrentTimeMs(): number;
  getDurationMs(): number;
  /** Detiene y vuelve al inicio (stopVideo en YouTube). */
  stop(): void;
  /** Prepara un contenido sin reproducirlo (cueVideoById en YouTube). */
  cue(opts: { videoId?: string; url?: string }): void;
  getVolume(): number;
  isMuted(): boolean;
  getPlaybackRate(): number;
  destroy(): void;
}
