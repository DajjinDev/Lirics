import { PlayerErrorCode } from '../models/music.models';
import { BackendEvents, PlaybackBackend } from './playback-backend';

/**
 * Reproduce un archivo de audio LOCAL del usuario (object URL) con un <audio> nativo.
 * Es el proveedor "independiente" de la especificación: al ser audio del propio usuario no hay
 * restricciones de incrustación y la interfaz puede ser totalmente personalizada. Su reloj
 * (`currentTime`) es la fuente de verdad, igual que con YouTube.
 */
export class LocalAudioBackend implements PlaybackBackend {
  readonly kind = 'local' as const;
  private readonly el = new Audio();

  constructor(private readonly events: BackendEvents) {
    const e = this.el;
    e.preload = 'auto';
    e.addEventListener('playing', () => events.state('PLAYING'));
    e.addEventListener('pause', () => {
      if (!e.ended) events.state('PAUSED');
    });
    e.addEventListener('waiting', () => events.state('BUFFERING'));
    e.addEventListener('ended', () => events.state('ENDED'));
    e.addEventListener('ratechange', () => events.rate?.(e.playbackRate));
    e.addEventListener('canplay', () => {
      if (e.paused && !e.ended) events.state('READY');
    });
    e.addEventListener('error', () => {
      const code: PlayerErrorCode = e.error?.code === 4 ? 'NOT_FOUND' : 'UNKNOWN';
      events.error(
        code,
        e.error?.code === 4
          ? 'Tu navegador no puede reproducir este formato de audio. Prueba con MP3, WAV, M4A u OGG.'
          : 'No se pudo reproducir el archivo de audio.',
      );
    });
  }

  async load(opts: { url?: string }): Promise<void> {
    if (!opts.url) throw new Error('Falta el archivo de audio.');
    this.events.state('LOADING');
    this.el.src = opts.url;
    this.el.load();
  }

  play(): void {
    void this.el.play().catch(() => {
      /* bloqueado por el navegador: el usuario pulsará reproducir */
    });
  }
  pause(): void {
    this.el.pause();
  }
  seek(ms: number): void {
    this.el.currentTime = Math.max(0, ms) / 1000;
  }
  setVolume(p: number): void {
    this.el.volume = Math.min(1, Math.max(0, p / 100));
  }
  setMuted(m: boolean): void {
    this.el.muted = m;
  }
  getCurrentTimeMs(): number {
    return this.el.currentTime * 1000;
  }
  getDurationMs(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration * 1000 : 0;
  }
  stop(): void {
    this.el.pause();
    this.el.currentTime = 0;
  }
  cue(opts: { url?: string }): void {
    if (opts.url) {
      this.el.src = opts.url;
      this.el.load();
    }
  }
  getVolume(): number {
    return Math.round(this.el.volume * 100);
  }
  isMuted(): boolean {
    return this.el.muted;
  }
  getPlaybackRate(): number {
    return this.el.playbackRate;
  }
  destroy(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }
}
