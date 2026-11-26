import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { LyricsSyncEngine, WordMode } from '../../core/lyrics/lyrics-sync-engine';
import { SyncedLyrics, SyncState } from '../../core/models/lyrics.models';
import { DynamicThemeService } from '../../core/services/dynamic-theme.service';
import { PlaybackService } from '../../core/services/playback.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/icon.component';

/**
 * Letras sincronizadas. Rendimiento:
 *  - Un solo bucle requestAnimationFrame lee el reloj del reproductor y
 *    consulta el motor (O(log n)).
 *  - El cambio de línea activa pasa por una señal (actualiza clases y hace el
 *    scroll). El progreso por palabra NO pasa por Angular: se escribe como
 *    variable CSS `--p` solo en las palabras de la línea activa.
 *  - Solo se animan transform y opacity (y un desenfoque opcional).
 */
@Component({
  selector: 'app-synced-lyrics',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.karaoke]': 'view() === "karaoke"', '[style.--mode-scale]': 'modeScale()' },
  template: `
    <div
      #viewport
      class="viewport"
      role="region"
      aria-label="Letra de la canción"
      tabindex="0"
      (wheel)="onUserScroll()"
      (touchmove)="onUserScroll()"
      (keydown)="onKey($event)"
    >
      <ol class="lines" [class.blur]="blurOn()" [class.center]="centered()">
        @for (line of lyrics().lines; track line.id; let i = $index) {
          <li
            #lineEl
            class="line"
            [class.is-active]="i === active()"
            [class.past]="i < active()"
            [class.brk]="line.isBreak"
            [attr.data-d]="distance(i)"
            [attr.aria-current]="i === active() && !line.isBreak ? 'true' : null"
            [attr.aria-hidden]="line.isBreak ? 'true' : null"
          >
            @if (line.isBreak) {
              <span class="dots"><i></i><i></i><i></i></span>
            } @else {
              <button
                type="button"
                class="text"
                title="Ir a esta frase"
                [attr.tabindex]="i === active() ? 0 : -1"
                (click)="seekTo(i)"
              >
                @if (words()[i]; as ws) {
                  @for (w of ws; track $index) {
                    <span class="w">{{ w.text.trimEnd() }}</span>@if (w.text !== w.text.trimEnd()) {&ngsp;}
                  }
                } @else {
                  {{ line.text }}
                }
              </button>
            }
          </li>
        }
      </ol>
    </div>

    @if (approxBadge()) {
      <p class="badge" role="note">Resaltado por palabra aproximado · no es sincronía vocal real</p>
    }
    @if (exploring()) {
      <button type="button" class="resume" (click)="resume()">
        <app-icon name="down" />
        Volver a la letra actual
      </button>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      height: 100%;
      min-height: 0;
    }
    .viewport {
      height: 100%;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: none;
      outline-offset: -4px;
      -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 12%, #000 80%, transparent 100%);
      mask-image: linear-gradient(to bottom, transparent 0, #000 12%, #000 80%, transparent 100%);
    }
    .viewport::-webkit-scrollbar {
      display: none;
    }
    .lines {
      position: relative;
      list-style: none;
      margin: 0;
      padding: 36vh 0 56vh;
    }

    .line {
      margin: 0 0 clamp(0.7rem, 2vh, 1.6rem);
      transform-origin: left center;
      transform: scale(0.9);
      opacity: var(--secondary-opacity);
      transition:
        opacity calc(0.55s / var(--speed)) var(--ease-out),
        transform calc(0.65s / var(--speed)) var(--ease-out),
        filter calc(0.55s / var(--speed)) var(--ease-out);
      will-change: transform, opacity;
      contain: layout style;
    }
    .center .line {
      transform-origin: center;
      text-align: center;
    }
    .line.is-active {
      opacity: 1;
      transform: scale(1);
    }
    .line.past {
      opacity: calc(var(--secondary-opacity) * 0.75);
    }
    .line[data-d='4'] {
      opacity: calc(var(--secondary-opacity) * 0.55);
    }
    .blur .line:not(.is-active)[data-d='1'] {
      filter: blur(0.5px);
    }
    .blur .line:not(.is-active)[data-d='2'] {
      filter: blur(1.4px);
    }
    .blur .line:not(.is-active)[data-d='3'] {
      filter: blur(2.4px);
    }
    .blur .line:not(.is-active)[data-d='4'] {
      filter: blur(3.4px);
    }

    .text {
      display: block;
      width: 100%;
      padding: 0;
      margin: 0;
      border: 0;
      background: none;
      text-align: inherit;
      cursor: pointer;
      color: var(--color-text-primary);
      font-size: calc(var(--fs-lyric-base) * var(--lyric-scale) * var(--mode-scale, 1));
      font-weight: var(--lyric-weight);
      line-height: 1.16;
      letter-spacing: -0.022em;
      text-wrap: balance;
      overflow-wrap: anywhere;
    }
    .text:focus-visible {
      outline-offset: 6px;
    }

    /* Relleno progresivo por palabra: --p (0–1) lo escribe el bucle de animación */
    .w {
      --p: 0;
      background-image: linear-gradient(
        90deg,
        #fff calc(var(--p) * 125% - 25%),
        rgb(255 255 255 / 0.4) calc(var(--p) * 125%)
      );
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    /* Las demás líneas se muestran completas; su opacidad ya las atenúa */
    .line:not(.is-active) .w {
      --p: 1;
    }
    /* Karaoke: la palabra que se canta se eleva levemente y brilla con el acento */
    :host(.karaoke) .w {
      display: inline-block;
      transition:
        transform calc(0.28s / var(--speed)) var(--ease-out),
        filter calc(0.28s / var(--speed)) var(--ease-out);
    }
    :host(.karaoke) .w.now {
      transform: translateY(-0.06em) scale(1.06);
      filter: drop-shadow(0 0 0.35em color-mix(in srgb, var(--color-accent) 70%, transparent));
    }

    /* Pausa instrumental: tres puntos que se encienden según el hueco real */
    .brk {
      --bp: 0;
      height: 3.4rem;
      display: flex;
      align-items: center;
      opacity: 0;
      transform: none;
    }
    .center .brk {
      justify-content: center;
    }
    .brk.is-active {
      opacity: 1;
    }
    .dots {
      display: inline-flex;
      gap: 0.7rem;
      animation: breathe calc(2.6s / var(--speed)) ease-in-out infinite;
    }
    .dots i {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      background: #fff;
      opacity: 0.25;
    }
    .dots i:nth-child(1) {
      opacity: calc(0.25 + 0.75 * clamp(0, var(--bp) * 3, 1));
    }
    .dots i:nth-child(2) {
      opacity: calc(0.25 + 0.75 * clamp(0, var(--bp) * 3 - 1, 1));
    }
    .dots i:nth-child(3) {
      opacity: calc(0.25 + 0.75 * clamp(0, var(--bp) * 3 - 2, 1));
    }
    @keyframes breathe {
      50% {
        transform: scale(1.12);
      }
    }

    .badge {
      position: absolute;
      left: 0;
      bottom: 0.4rem;
      margin: 0;
      font-size: 0.72rem;
      color: var(--color-text-tertiary);
    }
    .resume {
      position: absolute;
      left: 50%;
      bottom: 1.2rem;
      translate: -50% 0;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 1.1rem 0.65rem 0.9rem;
      border: 0;
      border-radius: 999px;
      background: rgb(255 255 255 / 0.92);
      color: #111;
      font-weight: 600;
      font-size: 0.9rem;
      box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.5);
    }
  `,
})
export class SyncedLyricsComponent {
  readonly lyrics = input.required<SyncedLyrics>();
  readonly offsetMs = input(0);

  protected readonly settings = inject(SettingsService);
  private readonly playback = inject(PlaybackService);
  private readonly theme = inject(DynamicThemeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly lineEls = viewChildren<ElementRef<HTMLElement>>('lineEl');

  protected readonly active = signal(-1);
  protected readonly exploring = signal(false);

  protected readonly view = computed(() => this.settings.settings().viewMode);
  protected readonly centered = computed(() => {
    const v = this.view();
    return this.settings.settings().alignment === 'center' || v === 'cinematic' || v === 'karaoke';
  });
  /** El modo minimalista prescinde de efectos decorativos (desenfoque incluido). */
  protected readonly blurOn = computed(() => this.settings.settings().blurInactive && this.view() !== 'minimal');
  protected readonly modeScale = computed(() => {
    switch (this.view()) {
      case 'cinematic':
        return 1.12;
      case 'karaoke':
        return 1.04;
      case 'cover':
        return 0.72;
      default:
        return 1;
    }
  });
  private readonly mode = computed<WordMode>(() => {
    const p = this.settings.settings().wordSync;
    if (p === 'off') return 'off';
    // Karaoke pide palabras: sin datos reales usa el reparto aproximado (y el aviso lo rotula).
    if (p === 'approximate' || this.view() === 'karaoke') return 'approximate';
    return 'real';
  });
  private readonly engine = computed(() => new LyricsSyncEngine(this.lyrics(), this.mode()));
  protected readonly words = computed(() => {
    const e = this.engine();
    return e.lines.map((_, i) => e.wordsFor(i) ?? null);
  });
  protected readonly approxBadge = computed(
    () => this.mode() === 'approximate' && this.lyrics().synchronizationType !== 'word',
  );

  private raf = 0;
  private lastBreakProgress = -1;
  private lastWordValues: number[] = [];
  private activeWordEls: HTMLElement[] = [];
  private nowWord = -1;
  private lastT = NaN;
  private lastOffset = NaN;
  private lastEngine: LyricsSyncEngine | null = null;

  constructor() {
    // Letras nuevas (otra canción/versión o cambio de modo): se reinicia el estado visual.
    effect(() => {
      this.engine();
      untracked(() => this.resetView());
    });

    afterNextRender(() => {
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        this.frame();
      };
      this.raf = requestAnimationFrame(loop);

      // Re-centra la línea activa si cambia el tamaño (rotación, redimensionado, pantalla completa).
      const ro = new ResizeObserver(() => {
        if (!this.exploring()) this.scrollToActive(this.active(), false);
      });
      ro.observe(this.viewport().nativeElement);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.raf);
      this.theme.breakActive.set(false);
    });
  }

  protected distance(i: number): number {
    const a = this.active();
    return a < 0 ? Math.min(4, i + 1) : Math.min(4, Math.abs(i - a));
  }

  protected seekTo(i: number): void {
    const line = this.lyrics().lines[i];
    if (!line || line.isBreak) return;
    // El reproductor está en (inicio + offset) cuando esta línea debe mostrarse.
    this.playback.seek(line.startTime + this.offsetMs());
    this.exploring.set(false);
  }

  protected onUserScroll(): void {
    this.exploring.set(true);
  }

  protected onKey(e: KeyboardEvent): void {
    // Con el foco en una frase, ↑/↓ saltan a la anterior/siguiente (solo la activa es parada de tabulador).
    const target = e.target as HTMLElement;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && target.classList.contains('text')) {
      const buttons = this.lineEls().map((l) => l.nativeElement.querySelector<HTMLElement>('.text')).filter((b): b is HTMLElement => !!b);
      const next = buttons[buttons.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        this.exploring.set(true);
        next.focus();
      }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
      this.exploring.set(true);
    }
  }

  protected resume(): void {
    this.exploring.set(false);
    this.scrollToActive(this.active(), true);
  }

  /* ----------------------------- bucle por frame ----------------------------- */

  private frame(): void {
    const engine = this.engine();
    const t = this.playback.now();
    const offset = this.offsetMs();
    // En pausa (mismo tiempo, mismo motor y mismo ajuste) no hay nada que recalcular.
    if (t === this.lastT && offset === this.lastOffset && engine === this.lastEngine) return;
    this.lastT = t;
    this.lastOffset = offset;
    this.lastEngine = engine;
    const st = engine.resolve(t, offset);
    if (st.activeIndex !== this.active()) this.onActiveChange(st.activeIndex);
    this.paint(st, engine);
  }

  private onActiveChange(next: number): void {
    const prev = this.active();
    this.clearWordStyles();
    this.active.set(next);
    this.activeWordEls = [];
    this.nowWord = -1;
    this.lastWordValues = [];
    this.lastBreakProgress = -1;
    this.theme.breakActive.set(this.lyrics().lines[next]?.isBreak ?? false);
    if (!this.exploring()) {
      const jump = prev < 0 || Math.abs(next - prev) > 3;
      this.scrollToActive(next, !jump);
    }
  }

  private paint(st: SyncState, engine: LyricsSyncEngine): void {
    if (st.activeIndex < 0) return;
    const el = this.lineEls()[st.activeIndex]?.nativeElement;
    if (!el) return;

    if (st.isBreak) {
      const p = Math.round(st.breakProgress * 100) / 100;
      if (p !== this.lastBreakProgress) {
        this.lastBreakProgress = p;
        el.style.setProperty('--bp', String(p));
      }
      return;
    }
    if (!engine.wordsFor(st.activeIndex)) return;

    if (this.activeWordEls.length === 0) {
      this.activeWordEls = Array.from(el.querySelectorAll<HTMLElement>('.w'));
    }
    const wi = st.wordIndex;
    const wp = Math.round(st.wordProgress * 50) / 50; // pasos de 2 %: menos escrituras de estilo
    for (let i = 0; i < this.activeWordEls.length; i++) {
      const v = wi < 0 ? 0 : i < wi ? 1 : i === wi ? wp : 0;
      if (this.lastWordValues[i] !== v) {
        this.lastWordValues[i] = v;
        this.activeWordEls[i].style.setProperty('--p', String(v));
      }
    }
    // Palabra "actual" (énfasis del modo karaoke): solo se toca el DOM cuando cambia.
    if (wi !== this.nowWord) {
      this.activeWordEls[this.nowWord]?.classList.remove('now');
      this.activeWordEls[wi]?.classList.add('now');
      this.nowWord = wi;
    }
  }

  /** Quita el relleno escrito en línea para que la línea pase a "completa" por CSS. */
  private clearWordStyles(): void {
    for (const w of this.activeWordEls) {
      w.style.removeProperty('--p');
      w.classList.remove('now');
    }
  }

  private resetView(): void {
    this.clearWordStyles();
    this.activeWordEls = [];
    this.nowWord = -1;
    this.lastT = NaN;
    this.lastWordValues = [];
    this.lastBreakProgress = -1;
    this.theme.breakActive.set(false);
    this.active.set(-1);
    this.exploring.set(false);
    this.viewport()?.nativeElement.scrollTo({ top: 0 });
  }

  private scrollToActive(index: number, smooth: boolean): void {
    const vp = this.viewport().nativeElement;
    const el = this.lineEls()[index]?.nativeElement;
    if (!el) return;
    const top = Math.max(0, el.offsetTop + el.offsetHeight / 2 - vp.clientHeight * 0.4);
    vp.scrollTo({ top, behavior: smooth && !this.settings.reducedMotion() ? 'smooth' : 'auto' });
  }
}
