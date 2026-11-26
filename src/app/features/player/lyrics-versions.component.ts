import { ChangeDetectionStrategy, Component, ElementRef, inject, output, viewChild } from '@angular/core';
import { matchLevel, matchScore } from '../../core/lyrics/track-matcher';
import { ScoredLyricsCandidate } from '../../core/models/lyrics.models';
import { PlayerSessionService } from '../../core/services/player-session.service';
import { formatClock } from '../../shared/format';
import { IconComponent } from '../../shared/icon.component';
import { VideoLinkFormComponent } from './video-link-form.component';

/** Diálogo para elegir otra versión de letras o cambiar el video que suena. */
@Component({
  selector: 'app-lyrics-versions',
  imports: [IconComponent, VideoLinkFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dlg" aria-labelledby="versions-title" (click)="onBackdrop($event)">
      <header class="head">
        <h2 id="versions-title">Versión y fuente</h2>
        <button type="button" class="icon-btn" aria-label="Cerrar" (click)="close()">
          <app-icon name="close" />
        </button>
      </header>

      <section class="block">
        <h3>Video que se reproduce</h3>
        <p class="note">
          Pega el enlace de la versión que quieres escuchar. Las letras se comparan con la duración real de ese video.
        </p>
        <app-video-link-form fieldId="versions-link" (linked)="linked.emit($event); close()" />
      </section>

      <section class="block">
        <h3>Letras disponibles</h3>
        @if (session.alternatives().length === 0) {
          <p class="note">No hay otras versiones de letras para esta canción.</p>
        } @else {
          <ul class="list">
            @for (a of session.alternatives(); track a.candidate.externalId) {
              <li class="item" [class.current]="isCurrent(a)">
                <div class="text">
                  <span class="name">{{ a.candidate.trackName }} · {{ a.candidate.artistName }}</span>
                  <span class="meta">
                    {{ a.candidate.albumName || 'Sin álbum' }}
                    @if (a.candidate.durationMs) { · {{ clock(a.candidate.durationMs) }} }
                    · {{ syncLabel(a) }}
                  </span>
                  <span class="meta">
                    Coincidencia {{ levelLabel(a) }} ({{ score(a) }}/100)
                    @if (a.reasons.length) { — {{ a.reasons.join(', ') }} }
                  </span>
                </div>
                <button type="button" class="pick" [disabled]="isCurrent(a)" (click)="pick(a)">
                  {{ isCurrent(a) ? 'En uso' : 'Usar' }}
                </button>
              </li>
            }
          </ul>
        }
      </section>
    </dialog>
  `,
  styles: `
    .dlg {
      width: min(36rem, calc(100vw - 2rem));
      max-height: min(42rem, calc(100dvh - 2rem));
      padding: 0;
      border: 0;
      border-radius: 1.5rem;
      background: rgb(24 22 32 / 0.97);
      color: var(--color-text-primary);
      box-shadow:
        inset 0 0 0 1px var(--color-hairline),
        0 40px 80px -20px rgb(0 0 0 / 0.7);
      overflow-y: auto;
    }
    .dlg::backdrop {
      background: rgb(0 0 0 / 0.55);
      backdrop-filter: blur(6px);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.1rem 1.1rem 0.2rem 1.6rem;
    }
    h2 {
      margin: 0;
      font-size: 1.25rem;
    }
    h3 {
      margin: 0 0 0.3rem;
      font-size: 0.8rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--color-text-secondary);
    }
    .block {
      padding: 0.9rem 1.6rem 1.1rem;
    }
    .note {
      margin: 0 0 0.7rem;
      font-size: 0.85rem;
      color: var(--color-text-secondary);
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.7rem 0.9rem;
      border-radius: 1rem;
      background: var(--color-surface);
    }
    .item.current {
      box-shadow: inset 0 0 0 1.5px var(--color-accent);
    }
    .text {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      font-size: 0.78rem;
      color: var(--color-text-secondary);
    }
    .pick {
      flex: none;
      border: 0;
      border-radius: 999px;
      padding: 0.5rem 1rem;
      background: #fff;
      color: #111;
      font-weight: 600;
      font-size: 0.85rem;
    }
    .pick:disabled {
      background: transparent;
      color: var(--color-text-secondary);
      cursor: default;
    }
  `,
})
export class LyricsVersionsComponent {
  protected readonly session = inject(PlayerSessionService);
  readonly linked = output<string>();
  protected readonly clock = formatClock;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  open(): void {
    const el = this.dlg().nativeElement;
    if (!el.open) el.showModal();
  }
  close(): void {
    this.dlg().nativeElement.close();
  }
  protected onBackdrop(e: MouseEvent): void {
    if (e.target === this.dlg().nativeElement) this.close();
  }

  protected isCurrent(a: ScoredLyricsCandidate): boolean {
    return a.candidate.externalId === this.session.bestMatch()?.candidate.externalId && this.session.lyricsStatus() !== 'NOT_FOUND';
  }
  protected pick(a: ScoredLyricsCandidate): void {
    this.session.chooseLyrics(a.candidate.externalId);
    this.close();
  }
  protected syncLabel(a: ScoredLyricsCandidate): string {
    return a.candidate.wordSyncedFile
      ? 'sincronía por palabra'
      : a.candidate.syncedLrc
        ? 'sincronía por línea'
        : a.candidate.plainLyrics
          ? 'sin sincronía'
          : 'instrumental';
  }
  protected levelLabel(a: ScoredLyricsCandidate): string {
    const l = matchLevel(a);
    return l === 'high' ? 'alta' : l === 'probable' ? 'probable' : l === 'uncertain' ? 'incierta' : 'insuficiente';
  }
  protected score(a: ScoredLyricsCandidate): number {
    return matchScore(a);
  }
}
