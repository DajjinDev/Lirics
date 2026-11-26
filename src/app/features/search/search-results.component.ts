import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Track } from '../../core/models/music.models';
import { formatClock } from '../../shared/format';

/** Lista de resultados musicales (patrón listbox: la navegación la controla el combobox padre). */
@Component({
  selector: 'app-search-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="list" role="listbox" [id]="listId()" aria-label="Resultados de la búsqueda">
      @for (t of tracks(); track t.id; let i = $index) {
        <li
          role="option"
          class="row"
          [id]="optionId(i)"
          [class.active]="i === activeIndex()"
          [attr.aria-selected]="i === activeIndex()"
          (mousedown)="$event.preventDefault()"
          (click)="selected.emit(t)"
          (mousemove)="hovered.emit(i)"
        >
          @if (t.artworkThumbUrl) {
            <img class="art" [src]="t.artworkThumbUrl" alt="" width="48" height="48" loading="lazy" decoding="async" />
          } @else {
            <span class="art fallback" aria-hidden="true"></span>
          }
          <span class="text">
            <span class="title">{{ t.title }}</span>
            <span class="sub">{{ t.artist }}@if (t.album) { · {{ t.album }} }</span>
          </span>
          <span class="meta">
            @if (t.durationMs) {
              <span class="dur">{{ clock(t.durationMs) }}</span>
            }
            <span class="provider">{{ t.providerLabel }}</span>
          </span>
        </li>
      }
    </ul>
  `,
  styles: `
    .list {
      list-style: none;
      margin: 0;
      padding: 0.4rem;
      max-height: min(52vh, 28rem);
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgb(255 255 255 / 0.2) transparent;
    }
    .row {
      display: grid;
      grid-template-columns: 3rem 1fr auto;
      align-items: center;
      gap: 0.9rem;
      padding: 0.55rem 0.7rem;
      border-radius: 0.9rem;
      cursor: pointer;
      transition: background-color 0.15s;
    }
    .row.active {
      background: var(--color-surface-hover);
    }
    .art {
      width: 3rem;
      height: 3rem;
      border-radius: 0.5rem;
      object-fit: cover;
      background: var(--color-surface);
    }
    .fallback {
      display: block;
    }
    .text {
      display: grid;
      min-width: 0;
    }
    .title {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      font-size: var(--fs-meta);
      color: var(--color-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta {
      display: grid;
      justify-items: end;
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
      font-variant-numeric: tabular-nums;
    }
    .provider {
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-size: 0.65rem;
    }
    @media (max-width: 480px) {
      .provider {
        display: none;
      }
    }
  `,
})
export class SearchResultsComponent {
  readonly tracks = input.required<Track[]>();
  readonly activeIndex = input(-1);
  readonly listId = input('search-results');

  readonly selected = output<Track>();
  readonly hovered = output<number>();

  readonly clock = formatClock;

  optionId(i: number): string {
    return `${this.listId()}-opt-${i}`;
  }
}
