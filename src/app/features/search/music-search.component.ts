import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { SEARCH_CONFIG } from '../../core/config/app-config';
import { looksLikeUrl, parseYouTubeUrl } from '../../core/lyrics/text-normalize';
import { Track } from '../../core/models/music.models';
import { HistoryService } from '../../core/services/history.service';
import { MusicSearchService } from '../../core/services/music-search.service';
import { IconComponent } from '../../shared/icon.component';
import { SearchResultsComponent } from './search-results.component';

/**
 * Buscador protagonista de la portada. Acepta nombre de canción/artista/álbum
 * o un enlace de YouTube. Combobox accesible: ↑/↓ navegan, Enter abre,
 * Esc limpia.
 */
@Component({
  selector: 'app-music-search',
  imports: [IconComponent, SearchResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field" [class.open]="panelOpen()" [class.link]="isLink()">
      <app-icon [name]="isLink() ? 'link' : 'search'" class="lead" />
      <input
        #input
        class="input"
        type="text"
        role="combobox"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        placeholder="Canción, artista, álbum o enlace de YouTube"
        aria-label="Buscar música"
        aria-autocomplete="list"
        [attr.aria-expanded]="panelOpen()"
        aria-controls="home-results"
        [attr.aria-activedescendant]="activeId()"
        [value]="search.query()"
        (input)="onInput($event)"
        (keydown)="onKey($event)"
        (paste)="onPaste($event)"
        (focus)="focused.set(true)"
        (blur)="onBlur()"
      />
      @if (search.query()) {
        <button type="button" class="icon-btn clear" aria-label="Borrar búsqueda" (mousedown)="$event.preventDefault()" (click)="clear()">
          <app-icon name="close" />
        </button>
      }
    </div>

    <div class="status" aria-live="polite" role="status">
      @if (linkError()) {
        {{ linkError() }}
      } @else if (isLink()) {
        Enlace de YouTube detectado · pulsa Enter para abrirlo
      } @else if (search.state() === 'loading') {
        Buscando…
      } @else if (search.state() === 'empty' && search.videos().length === 0) {
        Sin resultados para «{{ search.query().trim() }}». Prueba con el nombre del artista y la canción.
      } @else if (search.state() === 'error') {
        {{ search.error() }}
      } @else if (search.state() === 'results' || search.videos().length) {
        {{ search.results().length }} resultados
      }
    </div>

    @if (search.queryReady() && !isLink()) {
      <div class="yt-row">
        @if (search.hasYoutubeKey) {
          <button
            type="button"
            class="yt-btn"
            [disabled]="search.videoState() === 'loading'"
            (mousedown)="$event.preventDefault()"
            (click)="search.searchYoutube()"
          >
            {{ search.videoState() === 'loading' ? 'Buscando en YouTube…' : 'Buscar también en YouTube' }}
          </button>
          <span class="yt-hint">Mayús + Enter · consume cuota de tu clave</span>
        }
        @if (search.videoError()) {
          <span class="yt-error" role="alert">{{ search.videoError() }}</span>
        }
      </div>
    }

    @if (panelOpen()) {
      <div class="panel">
        @if (showResults()) {
          <app-search-results
            listId="home-results"
            [tracks]="search.results()"
            [activeIndex]="active()"
            (selected)="open($event)"
            (hovered)="active.set($event)"
          />
        } @else {
          <div class="history" id="home-results" role="listbox" aria-label="Búsquedas recientes">
            <p class="history-title">Búsquedas recientes</p>
            @for (q of history.queries(); track q; let i = $index) {
              <div
                role="option"
                class="hist-row"
                [id]="'home-results-opt-' + i"
                [class.active]="i === active()"
                [attr.aria-selected]="i === active()"
                (mousedown)="$event.preventDefault()"
                (click)="runQuery(q)"
                (mousemove)="active.set(i)"
              >
                <app-icon name="clock" class="hist-icon" />
                <span class="hist-text">{{ q }}</span>
                <button type="button" class="icon-btn small" [attr.aria-label]="'Quitar «' + q + '» del historial'" (mousedown)="$event.preventDefault()" (click)="removeQuery($event, q)">
                  <app-icon name="close" />
                </button>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
    }
    .field {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      height: clamp(3.5rem, 3rem + 1.2vw, 4.5rem);
      padding: 0 0.9rem 0 1.4rem;
      border-radius: 999px;
      background: rgb(255 255 255 / 0.09);
      box-shadow: inset 0 0 0 1px var(--color-hairline);
      backdrop-filter: blur(18px);
      transition:
        background-color 0.25s,
        box-shadow 0.25s;
    }
    .field:focus-within {
      background: rgb(255 255 255 / 0.14);
      box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.4);
    }
    .field.open {
      border-radius: 1.75rem 1.75rem 0 0;
    }
    .lead {
      font-size: 1.5rem;
      opacity: 0.7;
      flex: none;
    }
    .field.link .lead {
      color: var(--color-accent);
      opacity: 1;
    }
    .input {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      font-size: clamp(1.05rem, 0.95rem + 0.4vw, 1.3rem);
      font-weight: 500;
      &::placeholder {
        color: var(--color-text-tertiary);
        font-weight: 400;
      }
    }
    .clear {
      flex: none;
      width: 2.4rem;
      height: 2.4rem;
    }
    .status {
      min-height: 1.5rem;
      margin: 0.7rem 1.4rem 0;
      font-size: var(--fs-meta);
      color: var(--color-text-secondary);
    }
    .yt-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.8rem;
      margin: 0.5rem 1.4rem 0;
      font-size: var(--fs-meta);
    }
    .yt-btn {
      padding: 0.35rem 0.9rem;
      border: 0;
      border-radius: 999px;
      background: var(--color-surface-hover);
      font-weight: 600;
      font-size: 0.8rem;
    }
    .yt-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .yt-hint {
      color: var(--color-text-tertiary);
    }
    .yt-error {
      color: #ffb4a8;
    }
    .panel {
      position: absolute;
      z-index: 10;
      left: 0;
      right: 0;
      top: clamp(3.5rem, 3rem + 1.2vw, 4.5rem);
      border-radius: 0 0 1.75rem 1.75rem;
      background: rgb(22 20 30 / 0.94);
      box-shadow:
        inset 0 0 0 1px var(--color-hairline),
        0 30px 60px -20px rgb(0 0 0 / 0.6);
      backdrop-filter: blur(24px);
      overflow: hidden;
    }
    .history {
      padding: 0.6rem 0.4rem 0.5rem;
    }
    .history-title {
      margin: 0.3rem 1rem 0.4rem;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--color-text-tertiary);
    }
    .hist-row {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.4rem 0.5rem 0.4rem 0.8rem;
      border-radius: 0.8rem;
      cursor: pointer;
    }
    .hist-row.active {
      background: var(--color-surface-hover);
    }
    .hist-icon {
      opacity: 0.5;
    }
    .hist-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .small {
      width: 2.1rem;
      height: 2.1rem;
      font-size: 0.9rem;
    }
  `,
})
export class MusicSearchComponent {
  protected readonly search = inject(MusicSearchService);
  protected readonly history = inject(HistoryService);
  private readonly router = inject(Router);

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly focused = signal(false);
  protected readonly active = signal(-1);
  protected readonly linkError = signal<string | null>(null);

  protected readonly isLink = computed(() => looksLikeUrl(this.search.query()));
  protected readonly showResults = computed(
    () =>
      !this.isLink() &&
      this.search.query().trim().length >= SEARCH_CONFIG.minimumQueryLength &&
      this.search.results().length > 0,
  );
  protected readonly showHistory = computed(
    () => this.search.query().trim().length < SEARCH_CONFIG.minimumQueryLength && this.history.queries().length > 0,
  );
  protected readonly panelOpen = computed(
    () => this.focused() && (this.showResults() || this.showHistory()),
  );
  protected readonly activeId = computed(() =>
    this.panelOpen() && this.active() >= 0 ? `home-results-opt-${this.active()}` : null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.search.cancel());
  }

  focus(): void {
    this.inputEl().nativeElement.focus();
  }

  protected onInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.linkError.set(null);
    this.active.set(-1);
    this.search.setQuery(value);
  }

  protected onPaste(e: ClipboardEvent): void {
    const pasted = e.clipboardData?.getData('text') ?? '';
    // Pegar un enlace válido lo abre directamente.
    if (looksLikeUrl(pasted) && parseYouTubeUrl(pasted)) {
      e.preventDefault();
      this.openLink(pasted);
    }
  }

  protected onKey(e: KeyboardEvent): void {
    const count = this.showResults() ? this.search.results().length : this.history.queries().length;
    switch (e.key) {
      case 'ArrowDown':
        if (count) {
          e.preventDefault();
          this.active.set((this.active() + 1) % count);
        }
        break;
      case 'ArrowUp':
        if (count) {
          e.preventDefault();
          this.active.set((this.active() - 1 + count) % count);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey && this.search.hasYoutubeKey) void this.search.searchYoutube();
        else this.submit();
        break;
      case 'Escape':
        if (this.search.query()) {
          e.preventDefault();
          this.clear();
        } else {
          this.inputEl().nativeElement.blur();
        }
        break;
    }
  }

  protected onBlur(): void {
    this.focused.set(false);
    this.active.set(-1);
  }

  protected clear(): void {
    this.search.reset();
    this.linkError.set(null);
    this.active.set(-1);
    this.focus();
  }

  protected removeQuery(e: Event, q: string): void {
    e.stopPropagation();
    this.history.removeQuery(q);
  }

  protected runQuery(q: string): void {
    this.search.setQuery(q, { immediate: true });
    this.history.addQuery(q);
    this.active.set(-1);
    this.focus();
  }

  protected open(track: Track): void {
    this.history.addQuery(this.search.query());
    void this.router.navigate(['/play', track.id]);
  }

  private submit(): void {
    const value = this.search.query().trim();
    if (!value) return;
    if (this.isLink()) {
      this.openLink(value);
      return;
    }
    const i = this.active();
    if (this.showResults() && i >= 0) {
      this.open(this.search.results()[i]);
    } else if (this.showHistory() && i >= 0) {
      this.runQuery(this.history.queries()[i]);
    } else if (this.showResults()) {
      this.open(this.search.results()[0]);
    } else {
      this.search.setQuery(value, { immediate: true });
    }
  }

  private openLink(value: string): void {
    const id = parseYouTubeUrl(value);
    if (!id) {
      this.linkError.set('Ese enlace no parece un video de YouTube. Prueba con una URL como https://www.youtube.com/watch?v=…');
      return;
    }
    this.search.reset();
    void this.router.navigate(['/play', `yt:${id}`]);
  }
}
