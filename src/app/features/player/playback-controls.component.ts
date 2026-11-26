import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlaybackService } from '../../core/services/playback.service';
import { IconComponent } from '../../shared/icon.component';

/**
 * Controles de reproducción. Solo se muestran las acciones que existen de
 * verdad: no hay "anterior/siguiente" porque aún no existe una cola de
 * reproducción.
 */
@Component({
  selector: 'app-playback-controls',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" role="group" aria-label="Controles de reproducción">
      <button type="button" class="icon-btn" aria-label="Retroceder 10 segundos" (click)="playback.seekBy(-10000)">
        <app-icon name="back10" />
      </button>
      <button
        type="button"
        class="play"
        [attr.aria-label]="playing() ? 'Pausar' : 'Reproducir'"
        [disabled]="!ready()"
        (click)="playback.toggle()"
      >
        <app-icon [name]="playing() ? 'pause' : 'play'" />
      </button>
      <button type="button" class="icon-btn" aria-label="Adelantar 10 segundos" (click)="playback.seekBy(10000)">
        <app-icon name="fwd10" />
      </button>
    </div>

    <div class="row secondary">
      <button
        type="button"
        class="icon-btn"
        aria-label="Repetir canción"
        [attr.aria-pressed]="playback.loop()"
        (click)="playback.toggleLoop()"
      >
        <app-icon name="repeat" />
      </button>
      <div class="volume">
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="silent() ? 'Activar sonido' : 'Silenciar'"
          [disabled]="playback.isDemo()"
          (click)="playback.toggleMute()"
        >
          <app-icon [name]="silent() ? 'mute' : 'volume'" />
        </button>
        <input
          class="vol"
          type="range"
          min="0"
          max="100"
          step="1"
          aria-label="Volumen"
          [value]="playback.muted() ? 0 : playback.volume()"
          [style.--fill.%]="playback.muted() ? 0 : playback.volume()"
          [disabled]="playback.isDemo()"
          (input)="onVolume($event)"
        />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.4rem;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: clamp(0.8rem, 2vw, 1.6rem);
    }
    .secondary {
      justify-content: space-between;
    }
    .play {
      display: grid;
      place-items: center;
      width: 4.2rem;
      height: 4.2rem;
      border: 0;
      border-radius: 50%;
      background: #fff;
      color: #111;
      font-size: 1.7rem;
      transition:
        transform 0.2s var(--ease-out),
        opacity 0.2s;
    }
    .play:hover {
      transform: scale(1.06);
    }
    .play:active {
      transform: scale(0.95);
    }
    .play:disabled {
      opacity: 0.4;
      cursor: default;
      transform: none;
    }
    .volume {
      display: flex;
      align-items: center;
      gap: 0.2rem;
      min-width: 0;
    }
    .vol {
      -webkit-appearance: none;
      appearance: none;
      width: clamp(5rem, 9vw, 8rem);
      height: 1.2rem;
      background: transparent;
      cursor: pointer;
    }
    .vol::-webkit-slider-runnable-track {
      height: 0.25rem;
      border-radius: 999px;
      background: linear-gradient(90deg, #fff var(--fill, 0%), rgb(255 255 255 / 0.22) var(--fill, 0%));
    }
    .vol::-moz-range-track {
      height: 0.25rem;
      border-radius: 999px;
      background: linear-gradient(90deg, #fff var(--fill, 0%), rgb(255 255 255 / 0.22) var(--fill, 0%));
    }
    .vol::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 0.8rem;
      height: 0.8rem;
      margin-top: -0.28rem;
      border-radius: 50%;
      background: #fff;
    }
    .vol::-moz-range-thumb {
      width: 0.8rem;
      height: 0.8rem;
      border: 0;
      border-radius: 50%;
      background: #fff;
    }
    .vol:disabled {
      opacity: 0.35;
      cursor: default;
    }
    /* En teléfonos el volumen lo controlan los botones físicos: se gana espacio para las letras */
    @media (max-width: 599px), (max-height: 520px) {
      .volume {
        display: none;
      }
      .secondary {
        justify-content: center;
      }
      .play {
        width: 3.6rem;
        height: 3.6rem;
      }
    }
  `,
})
export class PlaybackControlsComponent {
  protected readonly playback = inject(PlaybackService);

  protected silent(): boolean {
    return this.playback.muted() || this.playback.volume() === 0;
  }
  protected playing(): boolean {
    const s = this.playback.state();
    return s === 'PLAYING' || s === 'BUFFERING';
  }
  protected ready(): boolean {
    const s = this.playback.state();
    return s !== 'IDLE' && s !== 'LOADING' && s !== 'ERROR';
  }
  protected onVolume(e: Event): void {
    this.playback.setVolume(Number((e.target as HTMLInputElement).value));
  }
}
