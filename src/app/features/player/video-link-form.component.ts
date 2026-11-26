import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { AppError } from '../../core/models/music.models';
import { PlayerSessionService } from '../../core/services/player-session.service';
import { IconComponent } from '../../shared/icon.component';

/** Campo para vincular el enlace de YouTube de la versión que se quiere escuchar. */
@Component({
  selector: 'app-video-link-form',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="submit($event, field)">
      <label class="sr-only" [for]="fieldId()">Enlace de YouTube</label>
      <app-icon name="link" class="icon" />
      <input
        #field
        [id]="fieldId()"
        class="field"
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="Pega un enlace de YouTube"
        (input)="error.set(null)"
      />
      <button type="submit" class="go">Usar</button>
    </form>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .form {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.35rem 0.3rem 0.9rem;
      border-radius: 999px;
      background: var(--color-surface);
      box-shadow: inset 0 0 0 1px var(--color-hairline);
    }
    .form:focus-within {
      box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.45);
    }
    .icon {
      opacity: 0.6;
      font-size: 1.1rem;
    }
    .field {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      font-size: var(--fs-meta);
      padding: 0.45rem 0;
    }
    .field::placeholder {
      color: var(--color-text-tertiary);
    }
    .go {
      border: 0;
      border-radius: 999px;
      padding: 0.45rem 1rem;
      background: #fff;
      color: #111;
      font-weight: 600;
      font-size: 0.85rem;
    }
    .error {
      margin: 0.5rem 0.9rem 0;
      font-size: 0.8rem;
      color: #ffb4a8;
    }
  `,
})
export class VideoLinkFormComponent {
  readonly fieldId = input('video-link');
  /** Emite el id de video ya validado. */
  readonly linked = output<string>();

  private readonly session = inject(PlayerSessionService);
  protected readonly error = signal<string | null>(null);

  protected submit(e: Event, field: HTMLInputElement): void {
    e.preventDefault();
    try {
      const id = this.session.parseVideoInput(field.value);
      this.error.set(null);
      this.linked.emit(id);
    } catch (err) {
      this.error.set(err instanceof AppError ? err.userMessage : 'Enlace no válido.');
    }
  }
}
