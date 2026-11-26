/**
 * Modelos de letras. Todas las marcas de tiempo están en MILISEGUNDOS.
 *
 * Convención de offset (única en toda la app):
 *   offset > 0  →  las letras se muestran MÁS TARDE (se retrasan)
 *   offset < 0  →  las letras se muestran ANTES (se adelantan)
 * El motor busca la línea correspondiente a `tiempoReproductor - offset`.
 */

export interface LyricWord {
  /** Texto tal cual llega del proveedor (puede incluir el espacio final). */
  text: string;
  startTime: number;
  endTime: number;
}

export interface LyricLine {
  id: string;
  /** Texto de la línea. Vacío cuando la línea es una pausa instrumental. */
  text: string;
  startTime: number;
  endTime: number;
  /** Palabras con marcas reales de tiempo (solo si el proveedor las entrega). */
  words?: LyricWord[];
  /** true cuando la línea representa una pausa/intro instrumental. */
  isBreak: boolean;
  /**
   * true si `endTime` es una ESTIMACIÓN (el formato no traía el final de la línea). Solo afecta a la
   * animación de progreso; la línea activa siempre la decide el inicio de cada línea.
   */
  endInferred?: boolean;
}

export type SynchronizationType = 'line' | 'word' | 'syllable' | 'none';

export interface SyncedLyrics {
  trackId: string;
  language?: string;
  source: string;
  synchronizationType: SynchronizationType;
  /** Duración de la grabación a la que pertenecen las marcas (ms), si se conoce. */
  duration: number;
  lines: LyricLine[];
}

/** Estado de las letras de la pista actual. */
export type LyricsStatus =
  | 'IDLE'
  | 'SEARCHING'
  | 'FOUND_SYNCED'
  | 'FOUND_PLAIN'
  | 'NOT_FOUND'
  | 'MATCH_UNCERTAIN'
  | 'INSTRUMENTAL'
  | 'ERROR';

/** Candidato crudo devuelto por un proveedor de letras, antes de puntuarlo. */
export interface LyricsCandidate {
  providerId: string;
  externalId: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  durationMs?: number;
  instrumental: boolean;
  /** Texto LRC con marcas por línea. */
  syncedLrc?: string;
  /** Formato con marcas por palabra (YAML "lyricsfile" de LRCLIB). */
  wordSyncedFile?: string;
  plainLyrics?: string;
}

export interface ScoredLyricsCandidate {
  candidate: LyricsCandidate;
  /** 0..1 */
  confidence: number;
  /** Diferencia absoluta de duración respecto a la pista que suena (ms). */
  durationDeltaMs?: number;
  reasons: string[];
}

export type MatchLevel = 'high' | 'probable' | 'uncertain' | 'insufficient';

export interface LyricsLoadResult {
  status: LyricsStatus;
  lyrics?: SyncedLyrics;
  plainLyrics?: string;
  best?: ScoredLyricsCandidate;
  /** Todos los candidatos puntuados, el mejor primero (para elegir otra versión). */
  alternatives: ScoredLyricsCandidate[];
  message?: string;
}

/** Información de la línea/palabra activa para un instante dado. */
export interface SyncState {
  /** -1 si todavía no ha comenzado ninguna línea. */
  activeIndex: number;
  /** Progreso de la línea activa 0..1. */
  lineProgress: number;
  /** -1 si la línea no tiene palabras temporizadas. */
  wordIndex: number;
  wordProgress: number;
  /** true cuando la línea activa es una pausa instrumental. */
  isBreak: boolean;
  /** Progreso dentro de la pausa 0..1 (solo si isBreak). */
  breakProgress: number;
  phase: 'before' | 'active' | 'after';
}
