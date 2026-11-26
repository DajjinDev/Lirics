import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DynamicThemeService } from './core/services/dynamic-theme.service';
import { AmbientBackgroundComponent } from './features/visualizer/ambient-background.component';

/**
 * Raíz: el fondo ambiental vive aquí para que persista entre pantallas y el
 * cambio de color entre canciones sea continuo.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AmbientBackgroundComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip" href="#contenido">Saltar al contenido</a>
    <app-ambient-background />
    <div id="contenido" tabindex="-1"><router-outlet /></div>
  `,
  styles: `
    .skip {
      position: fixed;
      z-index: 100;
      top: 0.5rem;
      left: 0.5rem;
      padding: 0.6rem 1rem;
      border-radius: 999px;
      background: #fff;
      color: #111;
      font-weight: 600;
      transform: translateY(-200%);
    }
    .skip:focus {
      transform: none;
    }
    #contenido {
      outline: none;
    }
  `,
})
export class App {
  constructor() {
    inject(DynamicThemeService); // instancia el servicio que publica la paleta como variables CSS
  }
}
