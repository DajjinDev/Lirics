import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  themeFromColors,
  ColorEntry,
  fallbackPalette,
  hexToRgb,
  hslToHex,
  relativeLuminance,
  rgbToHsl,
} from './palette';

/** Paleta sintética: lista de [r,g,b,cantidad] → entradas con su proporción (como las da Color Thief). */
function pixels(parts: [number, number, number, number][]): ColorEntry[] {
  const total = parts.reduce((a, p) => a + p[3], 0);
  return parts.map(([r, g, b, n]) => ({ hsl: rgbToHsl(r, g, b), share: n / total }));
}

describe('conversiones de color', () => {
  it('rgb ↔ hsl ↔ hex son coherentes', () => {
    const { h, s, l } = rgbToHsl(255, 0, 0);
    expect(h).toBe(0);
    expect(s).toBe(1);
    expect(l).toBeCloseTo(0.5);
    expect(hslToHex({ h: 120, s: 1, l: 0.5 })).toBe('#00ff00');
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
  });

  it('calcula el contraste WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});

describe('extractPalette', () => {
  it('una portada rojiza produce una paleta cálida con texto legible', () => {
    const p = themeFromColors(
      pixels([
        [138, 32, 29, 600],
        [206, 76, 37, 250],
        [230, 174, 103, 120],
        [20, 10, 10, 200],
      ]),
    )!;
    expect(p.mood).toBe('warm');
    expect(p.fromArtwork).toBe(true);
    expect(contrastRatio(p.dominant, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.secondary, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(p.dark)).toBeLessThan(0.02);
  });

  it('una portada azul produce una paleta fría distinta', () => {
    const warm = themeFromColors(pixels([[190, 50, 40, 500], [230, 160, 90, 100]]))!;
    const cool = themeFromColors(pixels([[30, 60, 190, 500], [120, 90, 220, 100]]))!;
    expect(cool.mood).toBe('cool');
    expect(cool.dominant).not.toBe(warm.dominant);
  });

  it('un acento vivo y pequeño se detecta pese a un fondo oscuro dominante', () => {
    const p = themeFromColors(pixels([[15, 15, 25, 900], [40, 40, 120, 300], [250, 200, 40, 60]]))!;
    expect(p.accent).not.toBe(p.dominant);
    const [r, g] = hexToRgb(p.accent);
    expect(r + g).toBeGreaterThan(300); // amarillento
  });

  it('una imagen en escala de grises es neutra y sigue siendo legible', () => {
    const p = themeFromColors(pixels([[120, 120, 120, 400], [60, 60, 60, 200]]))!;
    expect(p.mood).toBe('neutral');
    expect(contrastRatio(p.dominant, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('una portada casi blanca no genera un fondo claro', () => {
    const p = themeFromColors(pixels([[250, 250, 245, 900], [200, 60, 60, 40]]))!;
    expect(contrastRatio(p.dominant, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('devuelve null sin colores utilizables', () => {
    expect(themeFromColors([])).toBeNull();
    expect(themeFromColors([{ hsl: { h: 0, s: 0, l: 0.5 }, share: 0 }])).toBeNull();
  });
});

describe('fallbackPalette', () => {
  it('es determinista, legible y se identifica como no proveniente de portada', () => {
    const a = fallbackPalette('Canción|Artista');
    expect(a).toEqual(fallbackPalette('Canción|Artista'));
    expect(a.fromArtwork).toBe(false);
    expect(contrastRatio(a.dominant, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(fallbackPalette('Otra|Cosa').dominant).not.toBe(a.dominant);
  });
});
