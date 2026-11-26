import { effect, inject, Injectable, signal } from '@angular/core';
import { cssVarsFor, fallbackPalette, ThemePalette } from './palette';
import { FONT_FAMILIES, SettingsService } from './settings.service';

const DEFAULT_PALETTE: ThemePalette = fallbackPalette('liriks');

/**
 * Publica la paleta de la canción y los ajustes visuales como variables CSS
 * en :root. Los colores están registrados con @property (ver styles.scss),
 * así que el navegador anima el cambio cromático entre canciones.
 */
@Injectable({ providedIn: 'root' })
export class DynamicThemeService {
  private readonly settings = inject(SettingsService);
  readonly palette = signal<ThemePalette>(DEFAULT_PALETTE);
  /** true mientras las letras están en una pausa instrumental REAL (según sus marcas de tiempo). */
  readonly breakActive = signal(false);
  private readonly loadedFonts = new Set<string>(['jakarta']); // Plus Jakarta Sans ya viene en index.html

  constructor() {
    effect(() => {
      const root = document.documentElement;
      for (const [k, v] of Object.entries(cssVarsFor(this.palette()))) root.style.setProperty(k, v);
      root.dataset['mood'] = this.palette().mood;
    });
    effect(() => {
      const s = this.settings.settings();
      const reduced = this.settings.reducedMotion();
      const root = document.documentElement;
      root.style.setProperty('--lyric-scale', String(s.lyricScale));
      root.style.setProperty('--lyric-weight', String(s.lyricWeight));
      root.style.setProperty('--ambient-intensity', String(s.ambientIntensity));
      root.style.setProperty('--secondary-opacity', String(s.secondaryOpacity));
      // La duración base de las transiciones se divide por la velocidad elegida.
      root.style.setProperty('--speed', reduced ? '0.01' : String(s.transitionSpeed));
      root.dataset['reduceMotion'] = String(reduced);
      root.dataset['ambientMotion'] = String(s.ambientMotion && !reduced);
      root.dataset['view'] = s.viewMode;
      root.style.setProperty('--cover-scale', String(s.coverScale));

      const font = FONT_FAMILIES.find((f) => f.id === s.fontFamily) ?? FONT_FAMILIES[0];
      this.ensureFont(font.id, font.gf);
      root.style.setProperty(
        '--font-sans',
        `${font.css}, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
      );
    });
  }

  /** Descarga la familia elegida una sola vez (stylesheet de Google Fonts). */
  private ensureFont(id: string, googleName: string): void {
    if (this.loadedFonts.has(id)) return;
    this.loadedFonts.add(id);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${googleName}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
  }

  setPalette(p: ThemePalette): void {
    this.palette.set(p);
  }

  reset(): void {
    this.breakActive.set(false);
    this.palette.set(DEFAULT_PALETTE);
  }
}
