import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contrastRatio } from './palette';

const getPalette = vi.fn();
vi.mock('colorthief', () => ({ getPalette: (...a: unknown[]) => getPalette(...a) }));

/** Color de Color Thief simulado: s y l van de 0 a 100, proportion de 0 a 1 (escalas reales de la v3.5). */
const color = (h: number, s: number, l: number, proportion: number) => ({ hsl: () => ({ h, s, l }), proportion });

/** Image simulada: las URL que contienen "bad" fallan al cargar. */
class FakeImage {
  crossOrigin = '';
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) {
    queueMicrotask(() => (v.includes('bad') ? this.onerror?.() : this.onload?.()));
  }
}

describe('ColorExtractionService (Color Thief)', () => {
  let svc: import('./color-extraction.service').ColorExtractionService;

  beforeEach(async () => {
    getPalette.mockReset();
    vi.stubGlobal('Image', FakeImage);
    vi.resetModules();
    const { ColorExtractionService } = await import('./color-extraction.service');
    svc = new ColorExtractionService();
  });

  it('convierte las escalas de Color Thief (0–100) y genera un tema legible', async () => {
    getPalette.mockResolvedValue([color(8, 70, 30, 0.6), color(20, 80, 45, 0.25), color(40, 75, 60, 0.1)]);
    const p = await svc.paletteFor(['https://x/cover.jpg'], 'seed');
    expect(p.fromArtwork).toBe(true);
    expect(p.mood).toBe('warm'); // matiz ≈ 8°: si s y l no se normalizaran, saldría un color absurdo
    expect(contrastRatio(p.dominant, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(getPalette).toHaveBeenCalledWith(expect.anything(), { colorCount: 8 });
  });

  it('la escala de saturación importa: una portada casi gris (s = 8 de 100) es NEUTRA, no "fría"', async () => {
    // Si s se tomara como 8 en vez de 0,08, se vería como un color saturado y el tema saldría "cool".
    getPalette.mockResolvedValue([color(220, 8, 40, 0.9), color(220, 6, 55, 0.1)]);
    const p = await svc.paletteFor(['https://x/gris.jpg'], 'seed');
    expect(p.fromArtwork).toBe(true);
    expect(p.mood).toBe('neutral');
  });

  it('una portada muy saturada (s = 80 de 100) NO es neutra', async () => {
    getPalette.mockResolvedValue([color(220, 80, 40, 0.9)]);
    expect((await svc.paletteFor(['https://x/viva.jpg'], 'seed')).mood).toBe('cool');
  });

  it('una portada fría produce una paleta distinta de una cálida', async () => {
    getPalette.mockResolvedValueOnce([color(8, 70, 30, 0.7)]);
    getPalette.mockResolvedValueOnce([color(220, 70, 30, 0.7)]);
    const warm = await svc.paletteFor(['https://x/a.jpg'], 's');
    const cool = await svc.paletteFor(['https://x/b.jpg'], 's');
    expect(warm.mood).toBe('warm');
    expect(cool.mood).toBe('cool');
    expect(cool.dominant).not.toBe(warm.dominant);
  });

  it('si la primera portada no carga, usa la siguiente', async () => {
    getPalette.mockResolvedValue([color(220, 60, 40, 0.8)]);
    const p = await svc.paletteFor(['https://x/bad.jpg', 'https://x/ok.jpg'], 'seed');
    expect(p.fromArtwork).toBe(true);
    expect(getPalette).toHaveBeenCalledTimes(1);
  });

  it('si Color Thief no puede leer los píxeles (CORS) pasa a la siguiente o al respaldo', async () => {
    getPalette.mockRejectedValueOnce(new Error('tainted canvas'));
    getPalette.mockResolvedValueOnce([color(120, 50, 35, 0.9)]);
    const p = await svc.paletteFor(['https://x/cors.jpg', 'https://x/ok.jpg'], 'seed');
    expect(p.fromArtwork).toBe(true);
    expect(getPalette).toHaveBeenCalledTimes(2);
  });

  it('sin ninguna portada legible devuelve la paleta de respaldo determinista', async () => {
    getPalette.mockRejectedValue(new Error('x'));
    const a = await svc.paletteFor(['https://x/bad.jpg', undefined], 'Canción|Artista');
    const b = await svc.paletteFor([], 'Canción|Artista');
    expect(a.fromArtwork).toBe(false);
    expect(a).toEqual(b);
    expect(contrastRatio(a.dominant, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('una respuesta vacía o nula de Color Thief no rompe nada', async () => {
    getPalette.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    expect((await svc.paletteFor(['https://x/1.jpg', 'https://x/2.jpg'], 's')).fromArtwork).toBe(false);
  });

  it('cachea por URL: la misma portada no se vuelve a procesar', async () => {
    getPalette.mockResolvedValue([color(300, 60, 40, 0.8)]);
    await svc.paletteFor(['https://x/c.jpg'], 's');
    await svc.paletteFor(['https://x/c.jpg'], 's');
    expect(getPalette).toHaveBeenCalledTimes(1);
  });
});
