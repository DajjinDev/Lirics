import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { FONT_FAMILIES, PlayerSettings, SettingsService, VIEW_MODES } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/icon.component';

/** Panel de personalización. Los cambios se aplican y guardan al instante. */
@Component({
  selector: 'app-player-settings',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dlg" aria-labelledby="settings-title" (click)="onBackdrop($event)">
      <header class="head">
        <h2 id="settings-title">Personalizar</h2>
        <button type="button" class="icon-btn" aria-label="Cerrar" (click)="close()">
          <app-icon name="close" />
        </button>
      </header>

      <div class="body">
        <h3>Visualización</h3>
        <label class="row">
          <span>Modo</span>
          <select [value]="s().viewMode" (change)="str('viewMode', $event)">
            @for (m of modes; track m.id) {
              <option [value]="m.id" [selected]="m.id === s().viewMode">{{ m.label }}</option>
            }
          </select>
        </label>
        <p class="mode-hint">{{ modeHint() }} · atajo: V</p>
        <label class="row">
          <span>Tamaño de la portada</span>
          <input type="range" min="0.7" max="1.3" step="0.05" [value]="s().coverScale" (input)="num('coverScale', $event)" />
          <output>{{ pct(s().coverScale) }}</output>
        </label>

        <h3>Letras</h3>
        <label class="row">
          <span>Tipografía</span>
          <select [value]="s().fontFamily" (change)="str('fontFamily', $event)">
            @for (f of fonts; track f.id) {
              <option [value]="f.id" [selected]="f.id === s().fontFamily">{{ f.label }}</option>
            }
          </select>
        </label>
        <label class="row">
          <span>Tamaño</span>
          <input type="range" min="0.8" max="1.4" step="0.05" [value]="s().lyricScale" (input)="num('lyricScale', $event)" />
          <output>{{ pct(s().lyricScale) }}</output>
        </label>
        <label class="row">
          <span>Peso</span>
          <select [value]="s().lyricWeight" (change)="weight($event)">
            <option value="500">Medio</option>
            <option value="600">Seminegrita</option>
            <option value="700">Negrita</option>
          </select>
        </label>
        <label class="row">
          <span>Alineación</span>
          <select [value]="s().alignment" (change)="str('alignment', $event)">
            <option value="left">Izquierda</option>
            <option value="center">Centrada</option>
          </select>
        </label>
        <label class="row">
          <span>Opacidad de líneas secundarias</span>
          <input type="range" min="0.15" max="0.7" step="0.01" [value]="s().secondaryOpacity" (input)="num('secondaryOpacity', $event)" />
          <output>{{ pct(s().secondaryOpacity) }}</output>
        </label>
        <label class="row">
          <span>Resaltado por palabra</span>
          <select [value]="s().wordSync" (change)="str('wordSync', $event)">
            <option value="auto">Solo si es real</option>
            <option value="approximate">Aproximado cuando no hay datos</option>
            <option value="off">Solo por línea</option>
          </select>
        </label>
        <label class="row check">
          <span>Desenfocar líneas no activas</span>
          <input type="checkbox" [checked]="s().blurInactive" (change)="bool('blurInactive', $event)" />
        </label>

        <h3>Atmósfera</h3>
        <label class="row">
          <span>Intensidad del fondo</span>
          <input type="range" min="0" max="1" step="0.05" [value]="s().ambientIntensity" (input)="num('ambientIntensity', $event)" />
          <output>{{ pct(s().ambientIntensity) }}</output>
        </label>
        <label class="row check">
          <span>Fondo con movimiento lento</span>
          <input type="checkbox" [checked]="s().ambientMotion" (change)="bool('ambientMotion', $event)" />
        </label>
        <label class="row">
          <span>Velocidad de las transiciones</span>
          <input type="range" min="0.5" max="1.5" step="0.1" [value]="s().transitionSpeed" (input)="num('transitionSpeed', $event)" />
          <output>{{ pct(s().transitionSpeed) }}</output>
        </label>
        <label class="row">
          <span>Movimiento</span>
          <select [value]="s().motion" (change)="str('motion', $event)">
            <option value="system">Según el sistema</option>
            <option value="reduced">Reducido</option>
            <option value="full">Completo</option>
          </select>
        </label>

        <h3>Catálogo</h3>
        <label class="col">
          <span>País del catálogo de Apple Music (2 letras)</span>
          <input
            type="text"
            maxlength="2"
            autocomplete="off"
            spellcheck="false"
            placeholder="Automático (p. ej. CO, US, ES)"
            [value]="s().country"
            (change)="str('country', $event)"
          />
          <small>Si no hay resultados en ese catálogo se prueba el de EE. UU. Vacío = el de tu navegador.</small>
        </label>

        <h3>YouTube</h3>
        <label class="col">
          <span>Clave de YouTube Data API v3 (opcional)</span>
          <input
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="Para buscar el video automáticamente"
            [value]="s().youtubeApiKey"
            (change)="str('youtubeApiKey', $event)"
          />
          <small>
            Se guarda solo en este navegador. Crea una clave propia y restríngela a este sitio (referentes HTTP). Sin clave
            puedes pegar enlaces de YouTube manualmente.
          </small>
        </label>
      </div>

      <footer class="foot">
        <button type="button" class="reset" (click)="settings.reset()">Restablecer valores</button>
        <button type="button" class="done" (click)="close()">Listo</button>
      </footer>
    </dialog>
  `,
  styles: `
    .dlg {
      width: min(34rem, calc(100vw - 2rem));
      max-height: min(46rem, calc(100dvh - 2rem));
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
      padding: 1.1rem 1.1rem 0 1.6rem;
    }
    h2 {
      margin: 0;
      font-size: 1.25rem;
    }
    h3 {
      margin: 1.3rem 0 0.4rem;
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--color-text-secondary);
    }
    .body {
      padding: 0 1.6rem 0.6rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr minmax(7rem, 11rem) 3rem;
      align-items: center;
      gap: 0.8rem;
      min-height: 2.6rem;
      font-size: 0.92rem;
    }
    .row.check {
      grid-template-columns: 1fr auto;
    }
    .row:has(select) {
      grid-template-columns: 1fr minmax(7rem, 14rem);
    }
    output {
      text-align: right;
      color: var(--color-text-secondary);
      font-variant-numeric: tabular-nums;
      font-size: 0.82rem;
    }
    input[type='range'] {
      width: 100%;
      accent-color: #fff;
    }
    input[type='checkbox'] {
      width: 1.2rem;
      height: 1.2rem;
      accent-color: #fff;
    }
    select,
    input[type='text'],
    input[type='password'] {
      width: 100%;
      padding: 0.55rem 0.7rem;
      border: 0;
      border-radius: 0.7rem;
      background: var(--color-surface);
      box-shadow: inset 0 0 0 1px var(--color-hairline);
      color: var(--color-text-primary);
    }
    select option {
      color: #111;
    }
    .mode-hint {
      margin: 0 0 0.4rem;
      font-size: 0.78rem;
      color: var(--color-text-tertiary);
    }
    .col {
      display: grid;
      gap: 0.4rem;
      font-size: 0.92rem;
    }
    small {
      color: var(--color-text-secondary);
      line-height: 1.4;
    }
    .foot {
      position: sticky;
      bottom: 0;
      display: flex;
      justify-content: space-between;
      padding: 0.9rem 1.6rem 1.2rem;
      background: linear-gradient(0deg, rgb(24 22 32) 60%, transparent);
    }
    .reset {
      border: 0;
      background: none;
      color: var(--color-text-secondary);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .done {
      border: 0;
      border-radius: 999px;
      padding: 0.6rem 1.4rem;
      background: #fff;
      color: #111;
      font-weight: 600;
    }
  `,
})
export class PlayerSettingsComponent {
  protected readonly settings = inject(SettingsService);
  protected readonly s = this.settings.settings;
  protected readonly modes = VIEW_MODES;
  protected readonly fonts = FONT_FAMILIES;
  protected modeHint(): string {
    return VIEW_MODES.find((m) => m.id === this.s().viewMode)?.hint ?? '';
  }
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

  protected pct(v: number): string {
    return `${Math.round(v * 100)} %`;
  }
  protected num(key: 'lyricScale' | 'secondaryOpacity' | 'ambientIntensity' | 'transitionSpeed' | 'coverScale', e: Event): void {
    this.settings.update(key, Number((e.target as HTMLInputElement).value));
  }
  protected bool(key: 'blurInactive' | 'ambientMotion', e: Event): void {
    this.settings.update(key, (e.target as HTMLInputElement).checked);
  }
  protected weight(e: Event): void {
    this.settings.update('lyricWeight', Number((e.target as HTMLSelectElement).value) as PlayerSettings['lyricWeight']);
  }
  protected str(key: 'alignment' | 'wordSync' | 'motion' | 'youtubeApiKey' | 'viewMode' | 'fontFamily' | 'country', e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    this.settings.update(key, v as never);
  }
}
