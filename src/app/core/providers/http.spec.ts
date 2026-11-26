import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../models/music.models';
import { fetchJson, InFlight, RateLimiter, TtlCache } from './http';
import { parseIsoDuration } from './iso-duration';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }));

describe('fetchJson', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('traduce los códigos HTTP a errores con mensajes comprensibles', async () => {
    const cases: [number, string][] = [
      [404, 'NOT_FOUND'],
      [401, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [429, 'RATE_LIMIT'],
      [500, 'HTTP'],
      [502, 'HTTP'],
    ];
    for (const [status, code] of cases) {
      fetchMock.mockImplementationOnce(() => json({}, status));
      await expect(fetchJson('https://x/y', { label: 'Servicio' })).rejects.toMatchObject({ code });
    }
  });

  it('un cuerpo que no es JSON es "respuesta inesperada", no un fallo técnico', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(fetchJson('https://x', { label: 'S' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('un fallo de red se explica sin exponer la URL', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await fetchJson('https://secreto.example/?key=ABC123', { label: 'S' }).catch((e) => e)) as AppError;
    expect(err.code).toBe('NETWORK');
    expect(err.message).not.toContain('ABC123');
    expect(err.message).not.toContain('secreto');
  });

  it('reintenta ante 503 respetando Retry-After (MusicBrainz está "ocupado" de forma intermitente)', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockImplementationOnce(() => json({ error: 'busy' }, 503, { 'Retry-After': '1' }))
      .mockImplementationOnce(() => json({ ok: true }));
    const p = fetchJson<{ ok: boolean }>('https://x', { label: 'S', retries: 2 });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // todavía esperando
    await vi.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('agotados los reintentos informa de que el servicio no está disponible', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => json({}, 503, { 'Retry-After': '1' }));
    const p = fetchJson('https://x', { label: 'S', retries: 1 }).catch((e) => e as AppError);
    await vi.advanceTimersByTimeAsync(5000);
    expect(((await p) as AppError).code).toBe('HTTP');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('el tiempo de espera entre reintentos tiene tope (un Retry-After enorme no cuelga la app)', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => json({}, 503, { 'Retry-After': '3600' })).mockImplementationOnce(() => json({ ok: 1 }));
    const p = fetchJson('https://x', { label: 'S', retries: 1 });
    await vi.advanceTimersByTimeAsync(5001);
    await expect(p).resolves.toEqual({ ok: 1 });
  });

  it('sin reintentos configurados, un 503 falla de inmediato', async () => {
    fetchMock.mockImplementation(() => json({}, 503));
    await expect(fetchJson('https://x', { label: 'S' })).rejects.toMatchObject({ code: 'HTTP' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mapError permite al proveedor traducir sus errores concretos', async () => {
    fetchMock.mockImplementation(() => json({ error: { reason: 'quotaExceeded' } }, 403));
    const mapError = (status: number, body: unknown) =>
      (body as { error?: { reason?: string } })?.error?.reason === 'quotaExceeded' ? new AppError('QUOTA', 'sin cuota') : null;
    await expect(fetchJson('https://x', { label: 'S', mapError })).rejects.toMatchObject({ code: 'QUOTA' });
    // si no lo reconoce, cae al mapeo genérico
    fetchMock.mockImplementation(() => json({}, 403));
    await expect(fetchJson('https://x', { label: 'S', mapError })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('la cancelación se propaga como AbortError y no como error de red', async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
    );
    const p = fetchJson('https://x', { label: 'S', signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('RateLimiter', () => {
  it('permite hasta `max` en la ventana y luego indica cuánto esperar', () => {
    let now = 0;
    const l = new RateLimiter(3, 1000, () => now);
    expect([l.acquire(), l.acquire(), l.acquire()]).toEqual([0, 0, 0]);
    now = 400;
    expect(l.acquire()).toBe(600); // el primero caduca en t=1000
    now = 1000;
    expect(l.acquire()).toBe(0); // la ventana se desliza
  });

  it('take() espera hasta tener hueco y serializa (1 petición/segundo)', async () => {
    vi.useFakeTimers();
    const l = new RateLimiter(1, 1100);
    const times: number[] = [];
    const t0 = Date.now();
    const run = async () => {
      await l.take();
      times.push(Date.now() - t0);
    };
    const all = Promise.all([run(), run(), run()]);
    await vi.advanceTimersByTimeAsync(3000);
    await all;
    expect(times[0]).toBe(0);
    expect(times[1]).toBeGreaterThanOrEqual(1100);
    expect(times[2]).toBeGreaterThanOrEqual(2200);
    vi.useRealTimers();
  });

  it('take() se puede cancelar', async () => {
    const l = new RateLimiter(1, 60_000);
    l.acquire();
    const ac = new AbortController();
    const p = l.take(ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('InFlight y TtlCache', () => {
  it('dos llamadas simultáneas con la misma clave comparten una sola ejecución', async () => {
    const f = new InFlight<number>();
    const factory = vi.fn(async () => 7);
    const [a, b] = await Promise.all([f.run('k', factory), f.run('k', factory)]);
    expect([a, b]).toEqual([7, 7]);
    expect(factory).toHaveBeenCalledTimes(1);
    await f.run('k', factory); // terminada la primera, una nueva sí ejecuta
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('un fallo no queda "atascado": la siguiente llamada reintenta', async () => {
    const f = new InFlight<number>();
    await expect(f.run('k', () => Promise.reject(new Error('x')))).rejects.toThrow();
    await expect(f.run('k', async () => 1)).resolves.toBe(1);
  });

  it('la caché expira y respeta su tamaño máximo', () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000, 2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // expulsa la más antigua
    expect(c.get('a')).toBeUndefined();
    expect(c.get('c')).toBe(3);
    vi.advanceTimersByTime(1001);
    expect(c.get('c')).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('parseIsoDuration', () => {
  it('interpreta las duraciones habituales de YouTube', () => {
    expect(parseIsoDuration('PT3M45S')).toBe(225_000);
    expect(parseIsoDuration('PT45S')).toBe(45_000);
    expect(parseIsoDuration('PT10M')).toBe(600_000);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3_723_000);
    expect(parseIsoDuration('PT1H')).toBe(3_600_000);
    expect(parseIsoDuration('P1DT1H')).toBe(90_000_000);
    expect(parseIsoDuration('PT3M45.5S')).toBe(225_500);
  });

  it('devuelve undefined para valores nulos, vacíos, inválidos o de duración cero', () => {
    for (const bad of [undefined, null, '', 'abc', 'P', 'PT', 'PT0S', 'P0D', '3:45', 'PT-5S', 'PTxS', '<script>']) {
      expect(parseIsoDuration(bad as string)).toBeUndefined();
    }
  });
});
