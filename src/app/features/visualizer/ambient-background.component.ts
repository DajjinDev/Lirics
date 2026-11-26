import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DynamicThemeService } from '../../core/services/dynamic-theme.service';
import { PlaybackService } from '../../core/services/playback.service';

/**
 * Atmósfera visual de la canción. No es la portada difuminada: son capas de
 * degradados con los colores extraídos (dominante, secundario, acento) sobre
 * un fondo oscuro, más viñeta y una textura sutil. Solo se animan
 * `transform` y `opacity` (composición en GPU) y todo se pausa cuando la
 * pestaña no está visible.
 */
@Component({
  selector: 'app-ambient-background',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.paused]': 'hidden()', 'aria-hidden': 'true' },
  template: `
    <div class="layer blob a"></div>
    <div class="layer blob b"></div>
    <div class="layer blob c"></div>
    <div class="layer glow"></div>
    <div class="layer vignette"></div>
    <div class="layer grain"></div>
    <div class="layer particles" [class.on]="showParticles()">
      @for (p of particles; track p.i) {
        <i [style.left.%]="p.x" [style.--size.px]="p.size" [style.--dur.s]="p.dur" [style.--delay.s]="p.delay"></i>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
      background: var(--color-background-dark);
      contain: strict;
    }
    .layer {
      position: absolute;
      inset: 0;
    }
    .blob {
      inset: auto;
      border-radius: 50%;
      opacity: calc(var(--ambient-intensity) * 0.95);
      will-change: transform;
    }
    .a {
      width: 95vmax;
      height: 95vmax;
      left: -28vmax;
      top: -34vmax;
      background: radial-gradient(circle at center, var(--color-dominant) 0%, transparent 62%);
      animation: drift-a calc(46s / var(--speed)) ease-in-out infinite alternate;
    }
    .b {
      width: 85vmax;
      height: 85vmax;
      right: -34vmax;
      bottom: -40vmax;
      background: radial-gradient(circle at center, var(--color-secondary) 0%, transparent 60%);
      animation: drift-b calc(58s / var(--speed)) ease-in-out infinite alternate;
    }
    .c {
      width: 55vmax;
      height: 55vmax;
      right: 8vmax;
      top: -22vmax;
      opacity: calc(var(--ambient-intensity) * 0.5);
      background: radial-gradient(circle at center, var(--color-accent) 0%, transparent 58%);
      animation: drift-c calc(70s / var(--speed)) ease-in-out infinite alternate;
    }
    .glow {
      background: linear-gradient(
        180deg,
        rgb(0 0 0 / 0.1) 0%,
        transparent 30%,
        rgb(0 0 0 / 0.38) 100%
      );
    }
    .vignette {
      background: radial-gradient(ellipse at 40% 45%, transparent 38%, rgb(0 0 0 / 0.55) 100%);
    }
    .grain {
      opacity: 0.07;
      mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    }

    /* Partículas: solo aparecen en una pausa instrumental real y mientras suena la música */
    .particles {
      opacity: 0;
      transition: opacity calc(1.2s / var(--speed));
    }
    .particles.on {
      opacity: 1;
    }
    .particles i {
      position: absolute;
      bottom: -4%;
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      background: color-mix(in srgb, var(--color-accent) 75%, white);
      box-shadow: 0 0 calc(var(--size) * 3) var(--color-accent);
      opacity: 0;
      animation: rise var(--dur) linear var(--delay) infinite;
      animation-play-state: paused;
    }
    .particles.on i {
      animation-play-state: running;
    }
    :host-context(:root[data-ambient-motion='false']) .particles {
      display: none;
    }
    @keyframes rise {
      0% {
        transform: translate3d(0, 0, 0);
        opacity: 0;
      }
      12% {
        opacity: 0.8;
      }
      100% {
        transform: translate3d(3vmax, -108vh, 0);
        opacity: 0;
      }
    }

    /* Minimalista: fondo más plano, sin textura ni movimiento */
    :host-context(:root[data-view='minimal']) {
      .blob {
        animation: none;
        opacity: calc(var(--ambient-intensity) * 0.5);
      }
      .grain,
      .particles {
        display: none;
      }
    }

    @keyframes drift-a {
      to {
        transform: translate3d(14vmax, 9vmax, 0) scale(1.12);
      }
    }
    @keyframes drift-b {
      to {
        transform: translate3d(-12vmax, -10vmax, 0) scale(1.08);
      }
    }
    @keyframes drift-c {
      to {
        transform: translate3d(-9vmax, 12vmax, 0) scale(1.2);
      }
    }

    /* Sin movimiento: ajuste del usuario, preferencia del sistema o pestaña oculta */
    :host(.paused) .blob {
      animation-play-state: paused;
    }
    :host-context(:root[data-ambient-motion='false']) .blob {
      animation: none;
    }
  `,
})
export class AmbientBackgroundComponent {
  readonly hidden = signal(typeof document !== 'undefined' && document.hidden);
  private readonly theme = inject(DynamicThemeService);
  private readonly playback = inject(PlaybackService);
  protected readonly showParticles = computed(() => this.theme.breakActive() && this.playback.isPlaying() && !this.hidden());

  /** Posiciones fijas (deterministas): el efecto es decorativo y reproducible. */
  protected readonly particles = Array.from({ length: 16 }, (_, i) => ({
    i,
    x: (i * 37 + 11) % 100,
    size: 3 + ((i * 5) % 6),
    dur: 9 + ((i * 7) % 8),
    delay: -((i * 13) % 12),
  }));

  constructor() {
    const onChange = () => this.hidden.set(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onChange));
  }
}
