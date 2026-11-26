import { LyricLine, LyricWord, SyncedLyrics, SyncState } from '../models/lyrics.models';
import { approximateWords } from './lyrics-builder';

export type WordMode = 'real' | 'approximate' | 'off';

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Motor de sincronización: dado un instante del reproductor devuelve qué
 * línea/palabra está activa. No conoce Angular, ni temporizadores, ni el DOM;
 * el tiempo SIEMPRE lo entrega quien lo llama (la fuente de verdad es el
 * reproductor), por eso pausar/saltar no puede producir desincronización.
 *
 * Complejidad: O(log n) por consulta (búsqueda binaria), más O(1) con la
 * pista del índice anterior cuando el tiempo avanza de forma continua.
 */
export class LyricsSyncEngine {
  private hint = 0;
  private readonly approxCache = new Map<number, LyricWord[]>();

  constructor(
    public readonly lyrics: SyncedLyrics,
    private readonly wordMode: WordMode = 'real',
  ) {}

  get lines(): readonly LyricLine[] {
    return this.lyrics.lines;
  }

  /**
   * @param playerTimeMs tiempo real del reproductor
   * @param offsetMs     >0 retrasa las letras, <0 las adelanta (ver lyrics.models)
   */
  resolve(playerTimeMs: number, offsetMs = 0): SyncState {
    const lines = this.lyrics.lines;
    const t = playerTimeMs - offsetMs;
    const idx = this.findActiveIndex(t);

    if (idx < 0) {
      return {
        activeIndex: -1,
        lineProgress: 0,
        wordIndex: -1,
        wordProgress: 0,
        isBreak: false,
        breakProgress: 0,
        phase: 'before',
      };
    }

    const line = lines[idx];
    const span = Math.max(1, line.endTime - line.startTime);
    const lineProgress = clamp01((t - line.startTime) / span);
    const isLast = idx === lines.length - 1;
    const phase: SyncState['phase'] = isLast && t >= line.endTime ? 'after' : 'active';

    if (line.isBreak) {
      return {
        activeIndex: idx,
        lineProgress,
        wordIndex: -1,
        wordProgress: 0,
        isBreak: true,
        breakProgress: lineProgress,
        phase,
      };
    }

    const words = this.wordsFor(idx, line);
    let wordIndex = -1;
    let wordProgress = 0;
    if (words && words.length > 0) {
      wordIndex = this.findWordIndex(words, t);
      if (wordIndex >= 0) {
        const w = words[wordIndex];
        wordProgress = clamp01((t - w.startTime) / Math.max(1, w.endTime - w.startTime));
      }
    }
    return {
      activeIndex: idx,
      lineProgress,
      wordIndex,
      wordProgress,
      isBreak: false,
      breakProgress: 0,
      phase,
    };
  }

  /**
   * Palabras que se usarán para resaltar la línea según el modo:
   *  - 'off': ninguna.
   *  - 'real': solo si el proveedor trae marcas por palabra.
   *  - 'approximate': las reales si existen; si no, un reparto aproximado.
   */
  wordsFor(index: number, line: LyricLine = this.lyrics.lines[index]): LyricWord[] | undefined {
    if (!line || line.isBreak || this.wordMode === 'off') return undefined;
    if (line.words && line.words.length > 0) return line.words;
    if (this.wordMode !== 'approximate') return undefined;
    let cached = this.approxCache.get(index);
    if (!cached) {
      cached = approximateWords(line);
      this.approxCache.set(index, cached);
    }
    return cached;
  }

  /** true si los tiempos de palabra de esa línea son un reparto estimado, no reales. */
  isApproximate(index: number): boolean {
    const line = this.lyrics.lines[index];
    return (
      this.wordMode === 'approximate' && !!line && !line.isBreak && !(line.words?.length ?? 0)
    );
  }

  /** Índice de la última línea con startTime <= t, o -1. */
  findActiveIndex(t: number): number {
    const lines = this.lyrics.lines;
    const n = lines.length;
    if (n === 0 || t < lines[0].startTime) {
      this.hint = 0;
      return -1;
    }
    // Camino rápido: reproducción continua dentro de la misma línea o la siguiente.
    const h = this.hint;
    if (h < n && lines[h].startTime <= t && (h + 1 >= n || t < lines[h + 1].startTime)) {
      return h;
    }
    if (
      h + 1 < n &&
      lines[h + 1].startTime <= t &&
      (h + 2 >= n || t < lines[h + 2].startTime)
    ) {
      this.hint = h + 1;
      return this.hint;
    }
    // Salto (seek) o primera consulta: búsqueda binaria.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].startTime <= t) lo = mid;
      else hi = mid - 1;
    }
    this.hint = lo;
    return lo;
  }

  private findWordIndex(words: LyricWord[], t: number): number {
    if (t < words[0].startTime) return -1;
    let lo = 0;
    let hi = words.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (words[mid].startTime <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
