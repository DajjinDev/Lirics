import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'play'
  | 'pause'
  | 'back10'
  | 'fwd10'
  | 'volume'
  | 'mute'
  | 'repeat'
  | 'expand'
  | 'collapse'
  | 'sliders'
  | 'search'
  | 'close'
  | 'link'
  | 'list'
  | 'clock'
  | 'down'
  | 'back'
  | 'view'
  | 'plus'
  | 'trash'
  | 'undo'
  | 'upload'
  | 'download'
  | 'target'
  | 'wand';

/** Iconos de trazo en línea (24×24). Decorativos: el botón que los contiene lleva la etiqueta accesible. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('play') {
          <path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5Z" fill="currentColor" stroke="none" />
        }
        @case ('pause') {
          <rect x="6" y="4" width="4.2" height="16" rx="1.2" fill="currentColor" stroke="none" />
          <rect x="13.8" y="4" width="4.2" height="16" rx="1.2" fill="currentColor" stroke="none" />
        }
        @case ('back10') {
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
          <text x="12" y="16" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">10</text>
        }
        @case ('fwd10') {
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
          <text x="12" y="16" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">10</text>
        }
        @case ('volume') {
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
        }
        @case ('mute') {
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <path d="m22 9-6 6M16 9l6 6" />
        }
        @case ('repeat') {
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        }
        @case ('expand') {
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        }
        @case ('collapse') {
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
        }
        @case ('sliders') {
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7.5" />
          <path d="m21 21-4.6-4.6" />
        }
        @case ('close') {
          <path d="M18 6 6 18M6 6l12 12" />
        }
        @case ('link') {
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        }
        @case ('list') {
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        }
        @case ('down') {
          <path d="M12 5v14M19 12l-7 7-7-7" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('trash') {
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
        }
        @case ('undo') {
          <path d="M3 7v6h6" />
          <path d="M3 13a9 9 0 1 0 3-7.7" />
        }
        @case ('upload') {
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        }
        @case ('download') {
          <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
        }
        @case ('target') {
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        }
        @case ('wand') {
          <path d="M5 19 17 7M14 4l1 2.5L17.5 7.5 15 8.5 14 11l-1-2.5L10.5 7.5 13 6.5zM19 13l.7 1.8 1.8.7-1.8.7L19 18l-.7-1.8-1.8-.7 1.8-.7z" />
        }
        @case ('view') {
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M9 4v16" />
        }
        @case ('back') {
          <path d="m15 18-6-6 6-6" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      font-size: 1.35rem;
      line-height: 0;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
