import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';

/**
 * Portada con sus proporciones originales (cuadrada), sombra ambiental
 * tomada del color dominante y fundido suave al cambiar de canción.
 */
@Component({
  selector: 'app-album-artwork',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame" [class.loaded]="loaded()">
      @if (current() && !failed()) {
        <img
          class="img"
          [src]="current()"
          [alt]="'Portada de ' + alt()"
          decoding="async"
          fetchpriority="high"
          (load)="loaded.set(true)"
          (error)="next()"
        />
      } @else {
        <div class="placeholder" role="img" [attr.aria-label]="'Sin portada para ' + alt()">
          <span>{{ initial() }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .frame {
      position: relative;
      aspect-ratio: 1;
      width: 100%;
      border-radius: clamp(0.6rem, 0.4rem + 0.5vw, 1rem);
      overflow: hidden;
      background: var(--color-surface);
      box-shadow:
        0 2.2rem 4.5rem -1.2rem color-mix(in srgb, var(--color-dominant) 70%, black),
        0 0.6rem 1.4rem -0.4rem rgb(0 0 0 / 0.5);
    }
    :host-context(:root[data-view='minimal']) .frame {
      box-shadow: none;
    }
    .img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transform: scale(1.04);
      transition:
        opacity calc(0.7s / var(--speed)) var(--ease-out),
        transform calc(0.9s / var(--speed)) var(--ease-out);
    }
    .loaded .img {
      opacity: 1;
      transform: none;
    }
    .placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, var(--color-dominant), var(--color-secondary));
      font-size: clamp(3rem, 8vw, 6rem);
      font-weight: 700;
      color: rgb(255 255 255 / 0.7);
    }
  `,
})
export class AlbumArtworkComponent {
  readonly src = input<string | undefined>();
  /** Portada alternativa (la que el proveedor documenta) por si la principal no carga. */
  readonly fallback = input<string | undefined>();
  readonly alt = input('la canción');

  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  private readonly attempt = signal(0);
  private readonly candidates = computed(() => [...new Set([this.src(), this.fallback()].filter((u): u is string => !!u))]);
  protected readonly current = computed(() => this.candidates()[this.attempt()]);

  /** La imagen falló: se prueba la siguiente; si no quedan, se muestra el marcador. */
  protected next(): void {
    if (this.attempt() + 1 < this.candidates().length) {
      this.loaded.set(false);
      this.attempt.update((n) => n + 1);
    } else {
      this.failed.set(true);
    }
  }
  protected readonly initial = computed(() => (this.alt().trim()[0] ?? '♪').toUpperCase());

  constructor() {
    // Al cambiar de portada se reinicia el fundido de entrada.
    effect(() => {
      this.src();
      untracked(() => {
        this.loaded.set(false);
        this.failed.set(false);
        this.attempt.set(0);
      });
    });
  }
}
