import { AppError } from '../models/music.models';

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Nombre del servicio, para los mensajes al usuario. */
  label: string;
  /** Reintentos ante 503/429 respetando `Retry-After` (MusicBrainz responde 503 cuando está ocupado). */
  retries?: number;
  /** Permite a un proveedor traducir sus errores concretos (p. ej. cuota agotada de YouTube). */
  mapError?: (status: number, body: unknown) => AppError | null;
}

const MAX_RETRY_WAIT_MS = 5000;

/**
 * GET JSON con cancelación, tiempo máximo y reintentos acotados. Traduce los fallos a `AppError`
 * con mensajes comprensibles; nunca expone URLs ni claves en el texto.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  let attemptsLeft = opts.retries ?? 0;
  for (;;) {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if (opts.signal?.aborted) throw err; // cancelación intencional: se propaga tal cual
      if (timeout.aborted) {
        throw new AppError('TIMEOUT', `${opts.label} tardó demasiado en responder. Inténtalo de nuevo.`, { cause: err });
      }
      throw new AppError('NETWORK', 'No hay conexión con el servicio. Revisa tu internet.', { cause: err });
    }

    if ((res.status === 503 || res.status === 429) && attemptsLeft > 0) {
      attemptsLeft--;
      const retryAfter = Number(res.headers.get('Retry-After'));
      const wait = Math.min(MAX_RETRY_WAIT_MS, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1) * 1000);
      await sleep(wait, opts.signal);
      continue;
    }

    if (!res.ok) throw await toError(res, opts);

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new AppError('BAD_RESPONSE', `${opts.label} devolvió una respuesta inesperada.`, { cause: err });
    }
  }
}

async function toError(res: Response, opts: FetchJsonOptions): Promise<AppError> {
  if (opts.mapError) {
    const body = await res.json().catch(() => null);
    const mapped = opts.mapError(res.status, body);
    if (mapped) return mapped;
  }
  if (res.status === 429) {
    return new AppError('RATE_LIMIT', `${opts.label} recibió demasiadas solicitudes. Espera un momento.`);
  }
  if (res.status === 404) return new AppError('NOT_FOUND', 'No se encontró el recurso solicitado.');
  if (res.status === 401 || res.status === 403) {
    return new AppError('FORBIDDEN', `${opts.label} no permitió la solicitud.`);
  }
  return new AppError('HTTP', `${opts.label} no está disponible ahora mismo (${res.status}).`);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelado', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Cancelado', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/** Caché en memoria con expiración, para no gastar cuotas en repeticiones. */
export class TtlCache<V> {
  private store = new Map<string, { at: number; value: V }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 100,
  ) {}
  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V): void {
    if (this.store.size >= this.max) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { at: Date.now(), value });
  }
}

/**
 * Limitador de frecuencia de ventana deslizante (en el cliente), para respetar los límites de
 * cada proveedor. `acquire()` no bloquea: devuelve 0 si hay hueco (y lo consume) o los ms que
 * faltan. `take()` espera hasta conseguir hueco.
 */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  acquire(): number {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
    if (this.stamps.length < this.max) {
      this.stamps.push(t);
      return 0;
    }
    return this.stamps[0] + this.windowMs - t;
  }

  async take(signal?: AbortSignal): Promise<void> {
    for (;;) {
      const wait = this.acquire();
      if (wait <= 0) return;
      await sleep(wait, signal);
    }
  }
}

/** Evita lanzar dos veces la misma petición mientras la primera sigue en curso. */
export class InFlight<V> {
  private readonly pending = new Map<string, Promise<V>>();
  run(key: string, factory: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const p = factory().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
}
