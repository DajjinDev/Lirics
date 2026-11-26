import { BackendEvents, PlaybackBackend } from './playback-backend';

/**
 * MODO DEMOSTRACIÓN (sin audio). Se usa únicamente cuando no hay un video
 * reproducible vinculado: avanza un reloj virtual para poder ver cómo se
 * mueven las letras. La interfaz lo identifica siempre como demostración;
 * no es un proveedor de música ni sincroniza con ninguna grabación real.
 */
export class DemoBackend implements PlaybackBackend {
  readonly kind = 'demo' as const;
  private pos = 0;
  private stamp = 0;
  private playing = false;
  private ended = false;

  constructor(
    private readonly durationMs: number,
    private readonly events: BackendEvents,
  ) {}

  async load(): Promise<void> {
    this.events.state('READY');
  }

  play(): void {
    if (this.ended) {
      this.pos = 0;
      this.ended = false;
    }
    this.stamp = performance.now();
    this.playing = true;
    this.events.state('PLAYING');
  }
  pause(): void {
    this.tick();
    this.playing = false;
    this.events.state('PAUSED');
  }
  seek(ms: number): void {
    this.pos = Math.min(Math.max(0, ms), this.durationMs);
    this.stamp = performance.now();
    this.ended = false;
  }
  setVolume(): void {}
  setMuted(): void {}

  getCurrentTimeMs(): number {
    this.tick();
    return this.pos;
  }
  getDurationMs(): number {
    return this.durationMs;
  }
  stop(): void {
    this.playing = false;
    this.pos = 0;
    this.ended = false;
    this.events.state('READY');
  }
  cue(): void {}
  getVolume(): number {
    return 0;
  }
  isMuted(): boolean {
    return false;
  }
  getPlaybackRate(): number {
    return 1;
  }
  destroy(): void {
    this.playing = false;
  }

  private tick(): void {
    if (!this.playing) return;
    const now = performance.now();
    this.pos += now - this.stamp;
    this.stamp = now;
    if (this.pos >= this.durationMs) {
      this.pos = this.durationMs;
      this.playing = false;
      this.ended = true;
      this.events.state('ENDED');
    }
  }
}
