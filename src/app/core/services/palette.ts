/**
 * Extracción de paleta desde píxeles RGBA + utilidades de color. Funciones
 * puras (sin DOM) para poder probarlas con datos sintéticos.
 */

export interface Hsl {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

export interface ThemePalette {
  dominant: string;
  secondary: string;
  accent: string;
  dark: string;
  light: string;
  /** Una paleta "caliente", "fría" o neutra: guía la dirección artística del fondo. */
  mood: 'warm' | 'cool' | 'neutral';
  /** true cuando viene de la portada; false si es de respaldo. */
  fromArtwork: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: clamp(s, 0, 1), l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Oscurece un color hasta que el texto blanco lo supere con el contraste pedido. */
export function ensureContrastWithWhite(hsl: Hsl, minRatio = 4.5): Hsl {
  const out = { ...hsl };
  for (let i = 0; i < 40 && contrastRatio(hslToHex(out), '#ffffff') < minRatio; i++) {
    out.l = Math.max(0.02, out.l - 0.02);
  }
  return out;
}

/** Color de una paleta con su peso en la imagen (fracción 0–1). */
export interface ColorEntry {
  hsl: Hsl;
  /** Proporción de píxeles que representa (Color Thief la llama `proportion`). */
  share: number;
}

/** Distancia circular de matiz (0–180). */
const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Elige dominante, secundario y acento a partir de los colores cuantizados de una portada
 * (los entrega Color Thief). Pondera por saturación —los colores vivos "dicen" más de una portada
 * que los grises— y descarta casi negro/casi blanco, que apenas la caracterizan.
 * Devuelve null si no hay colores utilizables.
 */
export function themeFromColors(colors: ColorEntry[]): ThemePalette | null {
  const usable = colors.filter((c) => c.share > 0 && Number.isFinite(c.hsl.h));
  if (usable.length === 0) return null;

  const entries = usable
    .map((c) => {
      const { s, l } = c.hsl;
      // Casi negro / casi blanco casi no caracterizan la portada.
      const lightnessWeight = l < 0.08 || l > 0.94 ? 0.05 : l < 0.18 || l > 0.85 ? 0.5 : 1;
      return { hsl: c.hsl, share: c.share, weight: c.share * (0.15 + s * s * 1.6) * lightnessWeight };
    })
    .sort((x, y) => y.weight - x.weight);

  const dominant = entries[0].hsl;
  const distinct = (c: Hsl, others: Hsl[]) =>
    others.every(
      (o) => (c.s < 0.15 || o.s < 0.15 ? Math.abs(c.l - o.l) > 0.2 : hueDist(c.h, o.h) > 28),
    );

  const secondary = entries.find((e) => e.share > 0.02 && distinct(e.hsl, [dominant]))?.hsl;
  const accent = entries
    .filter((e) => e.hsl.s > 0.35 && e.hsl.l > 0.3 && e.hsl.l < 0.85 && e.share > 0.005)
    .sort((x, y) => y.hsl.s * (0.5 + y.hsl.l) - x.hsl.s * (0.5 + x.hsl.l))
    .find((e) => distinct(e.hsl, [dominant]) || e.hsl.l > dominant.l + 0.15)?.hsl;

  return buildTheme(dominant, secondary, accent, true);
}

/** Convierte colores crudos en una paleta apta para texto blanco y fondo oscuro. */
export function buildTheme(
  dominantRaw: Hsl,
  secondaryRaw?: Hsl,
  accentRaw?: Hsl,
  fromArtwork = true,
): ThemePalette {
  const grayish = dominantRaw.s < 0.12;
  const dominant = ensureContrastWithWhite({
    h: dominantRaw.h,
    s: clamp(dominantRaw.s * 1.2, grayish ? 0 : 0.5, 0.9),
    l: clamp(dominantRaw.l, 0.26, 0.46),
  });
  const secondary = ensureContrastWithWhite(
    secondaryRaw
      ? { h: secondaryRaw.h, s: clamp(secondaryRaw.s * 1.15, 0.4, 0.9), l: clamp(secondaryRaw.l, 0.26, 0.46) }
      : { h: (dominant.h + 28) % 360, s: dominant.s * 0.9, l: dominant.l * 1.1 },
  );
  const accent: Hsl = accentRaw
    ? { h: accentRaw.h, s: clamp(accentRaw.s, 0.45, 0.9), l: clamp(accentRaw.l, 0.5, 0.72) }
    : { h: (dominant.h + 40) % 360, s: 0.7, l: 0.64 };
  const dark: Hsl = { h: dominant.h, s: clamp(dominant.s * 0.55, 0.05, 0.4), l: 0.06 };
  const light: Hsl = { h: dominant.h, s: clamp(dominant.s * 0.4, 0.05, 0.25), l: 0.96 };

  const warmish = (h: number) => h < 70 || h >= 330;
  const mood = grayish ? 'neutral' : warmish(dominant.h) ? 'warm' : 'cool';

  return {
    dominant: hslToHex(dominant),
    secondary: hslToHex(secondary),
    accent: hslToHex(accent),
    dark: hslToHex(dark),
    light: hslToHex(light),
    mood,
    fromArtwork,
  };
}

/** Hash determinista de texto (FNV-1a) para paletas de respaldo. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Paleta de respaldo cuando la portada no se puede analizar. Es determinista
 * por título/artista (cada canción conserva identidad), y se marca como NO
 * proveniente de la portada.
 */
export function fallbackPalette(seed: string): ThemePalette {
  const h = hashString(seed) % 360;
  return buildTheme(
    { h, s: 0.55, l: 0.34 },
    { h: (h + 42) % 360, s: 0.5, l: 0.32 },
    { h: (h + 20) % 360, s: 0.75, l: 0.64 },
    false,
  );
}

export function cssVarsFor(p: ThemePalette): Record<string, string> {
  return {
    '--color-dominant': p.dominant,
    '--color-secondary': p.secondary,
    '--color-accent': p.accent,
    '--color-background-dark': p.dark,
    '--color-light': p.light,
  };
}
