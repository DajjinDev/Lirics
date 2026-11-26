import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { OFFSET_CONFIG } from '../../core/config/app-config';
import { PlayerSessionService } from '../../core/services/player-session.service';
import { formatOffset } from '../../shared/format';

/**
 * Ajuste manual de sincronía por canción/versión.
 * Convención: valor positivo = las letras aparecen MÁS TARDE; negativo = ANTES.
 */
@Component({
  selector: 'app-sync-adjust',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box" role="group" aria-label="Ajuste de sincronización de las letras">
      <span class="label" id="sync-label">Sincronía</span>
      <button type="button" class="step" aria-label="Adelantar las letras 0,1 segundos" title="Adelantar las letras" (click)="session.nudgeOffset(-step)">−</button>
      <output class="value" aria-labelledby="sync-label" [class.changed]="session.offsetMs() !== 0">
        {{ format(session.offsetMs()) }}
      </output>
      <button type="button" class="step" aria-label="Retrasar las letras 0,1 segundos" title="Retrasar las letras" (click)="session.nudgeOffset(step)">+</button>
      <button type="button" class="reset" [disabled]="session.offsetMs() === 0" (click)="session.setOffset(0)">Restablecer</button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .box {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: var(--fs-meta);
    }
    .label {
      color: var(--color-text-secondary);
      margin-right: auto;
    }
    .step {
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 50%;
      background: var(--color-surface);
      font-size: 1.1rem;
      line-height: 1;
      transition: background-color 0.2s;
    }
    .step:hover {
      background: var(--color-surface-hover);
    }
    .value {
      min-width: 3.6rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-secondary);
    }
    .value.changed {
      color: var(--color-text-primary);
      font-weight: 600;
    }
    .reset {
      padding: 0.3rem 0.6rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--color-text-secondary);
      font-size: 0.78rem;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .reset:disabled {
      opacity: 0.3;
      cursor: default;
      text-decoration: none;
    }
  `,
})
export class SyncAdjustComponent {
  protected readonly session = inject(PlayerSessionService);
  protected readonly format = formatOffset;
  protected readonly step = OFFSET_CONFIG.stepMs;
}
