import { Injectable } from '@angular/core';
import { ColorEntry, fallbackPalette, themeFromColors, ThemePalette } from './palette';

const COLOR_COUNT = 8;

/**
 * Obtiene la paleta de una portada con Color Thief (cuantización OKLCH) y la convierte en un tema
 * con contraste garantizado (ver palette.ts). Se prueban las URL en orden; si ninguna se puede
 * leer (el servidor no autoriza leer sus píxeles por CORS, error de carga…), devuelve la paleta de
 * respaldo determinista, marcada `fromArtwork: false`.
 *
 * Color Thief se carga bajo demanda: no pesa en el bundle inicial.
 */
@Injectable({ providedIn: 'root' })
export class ColorExtractionService {
  private readonly cache = new Map<string, ThemePalette>();

  async paletteFor(urls: (string | undefined)[], seed: string): Promise<ThemePalette> {
    for (const url of [...new Set(urls.filter((u): u is string => !!u))]) {
      const hit = this.cache.get(url);
      if (hit) return hit;
      try {
        const img = await loadImage(url);
        const { getPalette } = await import('colorthief');
        const colors = await getPalette(img, { colorCount: COLOR_COUNT });
        // Color Thief entrega s y l en 0–100 y la proporción en 0–1: aquí se normaliza a 0–1.
        const entries: ColorEntry[] = (colors ?? []).map((c) => {
          const { h, s, l } = c.hsl();
          return { hsl: { h, s: s / 100, l: l / 100 }, share: c.proportion };
        });
        const palette = themeFromColors(entries);
        if (palette) {
          this.cache.set(url, palette);
          return palette;
        }
      } catch {
        /* esta portada no se pudo leer: se prueba la siguiente */
      }
    }
    return fallbackPalette(seed);
  }
}

/** Carga la imagen pidiendo permiso CORS (necesario para leer sus píxeles). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('no se pudo cargar la portada'));
    img.src = url;
  });
}
