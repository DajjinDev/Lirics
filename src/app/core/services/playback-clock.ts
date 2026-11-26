/**
 * Reloj de reproducción: interpola entre las lecturas del reproductor para
 * obtener un tiempo fluido a 60 FPS sin convertirse en una fuente de verdad
 * propia.
 *
 * Reglas:
 *  - Solo avanza mientras `playing` sea true (nunca corre en pausa/buffering).
 *  - Cada lectura real (`sample`) recalibra; si el error es grande (seek) se
 *    salta directamente, si es pequeño se corrige de forma gradual para no
 *    producir saltos visibles ni retrocesos.
 *  - La velocidad de reproducción se aplica a la interpolación.
 */
export class PlaybackClock {
  private base = 0; // ms del reproductor en `stamp`
  private stamp = 0; // marca de tiempo de la máquina (performance.now)
  private playing = false;
  private rate = 1;

  /** Error por encima del cual se considera un salto y no se suaviza. */
  static readonly SNAP_THRESHOLD_MS = 350;
  /** Fracción del error que se corrige en cada lectura pequeña. */
  static readonly BLEND = 0.35;

  constructor(private readonly nowFn: () => number = () => performance.now()) {}

  /** Tiempo estimado ahora (ms). */
  now(): number {
    if (!this.playing) return this.base;
    return this.base + (this.nowFn() - this.stamp) * this.rate;
  }

  /** Lectura real del reproductor. */
  sample(playerMs: number): void {
    const predicted = this.now();
    const err = playerMs - predicted;
    if (!this.playing || Math.abs(err) > PlaybackClock.SNAP_THRESHOLD_MS) {
      this.base = playerMs;
    } else {
      this.base = predicted + err * PlaybackClock.BLEND;
    }
    this.stamp = this.nowFn();
  }

  /** Cambia el estado de avance (play/pause/buffering). */
  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    // Congela o reanuda sin perder posición.
    this.base = this.now();
    this.stamp = this.nowFn();
    this.playing = playing;
  }

  setRate(rate: number): void {
    this.base = this.now();
    this.stamp = this.nowFn();
    this.rate = rate > 0 ? rate : 1;
  }

  /** Salto explícito (seek del usuario). */
  seek(ms: number): void {
    this.base = ms;
    this.stamp = this.nowFn();
  }

  reset(): void {
    this.base = 0;
    this.stamp = this.nowFn();
    this.playing = false;
    this.rate = 1;
  }

  get isPlaying(): boolean {
    return this.playing;
  }
}
