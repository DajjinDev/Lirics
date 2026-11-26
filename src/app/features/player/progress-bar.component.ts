import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PlaybackService } from '../../core/services/playback.service';
import { formatClock } from '../../shared/format';

/** Barra de progreso interactiva (input range nativo: teclado y lectores de pantalla incluidos). */
@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <input
        class="range"
        type="range"
        min="0"
        [max]="max()"
        step="100"
        [value]="shown()"
        [style.--fill.%]="percent()"
        [disabled]="!playback.durationMs()"
        aria-label="Progreso de la canción"
        [attr.aria-valuetext]="clock(shown()) + ' de ' + clock(max())"
        (input)="onScrub($event)"
        (change)="commit($event)"
      />
      <div class="times" aria-hidden="true">
        <span>{{ clock(shown()) }}</span>
        <span>−{{ clock(remaining()) }}</span>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .wrap {
      display: grid;
      gap: 0.35rem;
    }
    .range {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 1.2rem;
      margin: 0;
      background: transparent;
      cursor: pointer;
    }
    .range::-webkit-slider-runnable-track {
      height: 0.3rem;
      border-radius: 999px;
      background: linear-gradient(90deg, #fff var(--fill, 0%), rgb(255 255 255 / 0.22) var(--fill, 0%));
      transition: height 0.15s;
    }
    .range::-moz-range-track {
      height: 0.3rem;
      border-radius: 999px;
      background: linear-gradient(90deg, #fff var(--fill, 0%), rgb(255 255 255 / 0.22) var(--fill, 0%));
    }
    .range:hover::-webkit-slider-runnable-track,
    .range:focus-visible::-webkit-slider-runnable-track {
      height: 0.5rem;
    }
    .range::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 0;
      height: 0;
    }
    .range:hover::-webkit-slider-thumb,
    .range:focus-visible::-webkit-slider-thumb {
      width: 0.9rem;
      height: 0.9rem;
      margin-top: -0.2rem;
      border-radius: 50%;
      background: #fff;
    }
    .range::-moz-range-thumb {
      width: 0;
      height: 0;
      border: 0;
    }
    .range:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .times {
      display: flex;
      justify-content: space-between;
      font-size: var(--fs-meta);
      color: var(--color-text-secondary);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ProgressBarComponent {
  protected readonly playback = inject(PlaybackService);
  protected readonly clock = formatClock;
  private readonly scrubbing = signal(false);
  private readonly scrubValue = signal(0);

  protected readonly max = computed(() => Math.max(1, this.playback.durationMs()));
  protected readonly shown = computed(() =>
    Math.min(this.max(), this.scrubbing() ? this.scrubValue() : this.playback.positionMs()),
  );
  protected readonly remaining = computed(() => Math.max(0, this.max() - this.shown()));
  protected readonly percent = computed(() => (this.shown() / this.max()) * 100);

  protected onScrub(e: Event): void {
    this.scrubbing.set(true);
    this.scrubValue.set(Number((e.target as HTMLInputElement).value));
  }

  protected commit(e: Event): void {
    this.playback.seek(Number((e.target as HTMLInputElement).value));
    this.scrubbing.set(false);
  }
}
