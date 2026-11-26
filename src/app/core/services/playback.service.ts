import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { PlaybackSource, PlayerErrorCode, PlayerState } from '../models/music.models';
import { DemoBackend } from './demo-backend';
import { LocalAudioBackend } from './local-audio-backend';
import { PlaybackBackend } from './playback-backend';
import { PlaybackClock } from './playback-clock';
import { YouTubeBackend } from './youtube-backend';

export interface PlaybackError {
  code: PlayerErrorCode;
  message: string;
}

/**
 * Orquesta el backend de reproducción y expone su estado como señales.
 *
 * El tiempo que consume el motor de letras sale de `now()`: una interpolación
 * (PlaybackClock) recalibrada cada 250 ms con la lectura REAL del backend.
 * Nunca hay un temporizador propio que avance con el reproductor en pausa.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackService implements OnDestroy {
  readonly state = signal<PlayerState>('IDLE');
  readonly error = signal<PlaybackError | null>(null);
  readonly durationMs = signal(0);
  /** Posición "gruesa" (4 Hz) para la barra de progreso; las letras usan now(). */
  readonly positionMs = signal(0);
  readonly volume = signal(80);
  readonly muted = signal(false);
  readonly loop = signal(false);
  /** Velocidad de reproducción vigente (1 = normal). */
  readonly rate = signal(1);
  readonly sourceKind = signal<'youtube' | 'demo' | 'local' | null>(null);

  readonly isPlaying = computed(() => this.state() === 'PLAYING');
  readonly isDemo = computed(() => this.sourceKind() === 'demo');

  private readonly clock = new PlaybackClock();
  private backend: PlaybackBackend | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Invalida eventos de un backend anterior cuando el usuario cambia rápido de canción. */
  private generation = 0;

  /** Tiempo actual interpolado (ms). Barato: llamar en cada frame. */
  now(): number {
    return this.clock.now();
  }

  async load(
    source: PlaybackSource,
    host: HTMLElement | null,
    fallbackDurationMs: number,
  ): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.error.set(null);
    this.sourceKind.set(source.kind);
    this.durationMs.set(
      source.kind === 'youtube' || source.kind === 'local' ? (source.durationMs ?? 0) : fallbackDurationMs,
    );
    this.positionMs.set(0);
    this.clock.reset();

    const events = {
      state: (s: PlayerState) => gen === this.generation && this.onState(s),
      error: (code: PlayerErrorCode, message: string) => {
        if (gen !== this.generation) return;
        this.error.set({ code, message });
        this.state.set('ERROR');
        this.clock.setPlaying(false);
      },
      rate: (r: number) => {
        if (gen !== this.generation) return;
        // El reloj interpolado avanza a la velocidad real; si no, las letras irían a destiempo.
        this.clock.setRate(r);
        this.rate.set(r);
      },
    };

    try {
      if (source.kind === 'youtube') {
        if (!host) throw new Error('Falta el contenedor del reproductor.');
        this.backend = new YouTubeBackend(host, events);
        this.state.set('LOADING');
        await this.backend.load({ videoId: source.videoId });
      } else if (source.kind === 'local') {
        this.backend = new LocalAudioBackend(events);
        await this.backend.load({ url: source.url });
      } else {
        this.backend = new DemoBackend(fallbackDurationMs, events);
        await this.backend.load({});
      }
    } catch (e) {
      if (gen !== this.generation) return;
      this.error.set({
        code: 'API_LOAD_FAILED',
        message: e instanceof Error ? e.message : 'No se pudo iniciar la reproducción.',
      });
      this.state.set('ERROR');
      return;
    }
    if (gen !== this.generation) return;
    this.backend.setVolume(this.volume());
    this.backend.setMuted(this.muted());
    this.startSampling();
  }

  play(): void {
    this.backend?.play();
  }
  pause(): void {
    this.backend?.pause();
  }
  toggle(): void {
    if (this.state() === 'PLAYING' || this.state() === 'BUFFERING') this.pause();
    else this.play();
  }

  seek(ms: number): void {
    if (!this.backend) return;
    const dur = this.durationMs();
    const target = Math.max(0, dur > 0 ? Math.min(ms, dur) : ms);
    this.backend.seek(target);
    this.clock.seek(target);
    this.positionMs.set(target);
  }
  seekBy(deltaMs: number): void {
    this.seek(this.clock.now() + deltaMs);
  }

  /** Detiene la reproducción y vuelve al inicio. */
  stopPlayback(): void {
    if (!this.backend) return;
    this.backend.stop();
    this.clock.seek(0);
    this.clock.setPlaying(false);
    this.positionMs.set(0);
  }

  /** Prepara un contenido sin reproducirlo. */
  cue(opts: { videoId?: string; url?: string }): void {
    this.backend?.cue(opts);
  }

  setVolume(percent: number): void {
    const v = Math.min(100, Math.max(0, Math.round(percent)));
    this.volume.set(v);
    this.backend?.setVolume(v);
    if (v > 0 && this.muted()) this.setMuted(false);
  }
  setMuted(muted: boolean): void {
    this.muted.set(muted);
    this.backend?.setMuted(muted);
  }
  toggleMute(): void {
    this.setMuted(!this.muted());
  }
  toggleLoop(): void {
    this.loop.update((l) => !l);
  }

  /** Libera el reproductor y detiene todo temporizador. */
  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.backend?.destroy();
    this.backend = null;
    this.clock.reset();
    this.rate.set(1);
    this.state.set('IDLE');
    this.sourceKind.set(null);
    this.positionMs.set(0);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private onState(s: PlayerState): void {
    if (!this.backend) return;
    const real = this.backend.getCurrentTimeMs();
    if (s === 'PLAYING') {
      // Primero se fija la posición real y después se deja correr el reloj.
      this.clock.sample(real);
      this.clock.setPlaying(true);
      this.error.set(null);
    } else {
      this.clock.setPlaying(false);
      this.clock.sample(real);
    }
    this.state.set(s);
    if (s === 'ENDED' && this.loop()) {
      this.seek(0);
      this.play();
    }
  }

  private startSampling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.sample(), 250);
  }

  private sample(): void {
    const b = this.backend;
    if (!b) return;
    const real = b.getCurrentTimeMs();
    if (this.state() === 'PLAYING') this.clock.sample(real);
    this.positionMs.set(this.state() === 'PLAYING' ? this.clock.now() : real);
    const dur = b.getDurationMs();
    if (dur > 0 && Math.abs(dur - this.durationMs()) > 500) this.durationMs.set(dur);
  }
}
