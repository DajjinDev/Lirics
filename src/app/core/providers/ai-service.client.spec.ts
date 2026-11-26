import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanServiceUrl, SettingsService } from '../services/settings.service';
import { AiJobOptions, AiServiceClient, AiServiceError } from './ai-service.client';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const opts: AiJobOptions = { rightsConfirmed: true, separateVocals: false, modelSize: 'small' };
const file = () => new File([new Uint8Array(10)], 'secreto-mi-cancion.mp3', { type: 'audio/mpeg' });
const status = (over: Record<string, unknown>) => ({
  id: 'j1',
  state: 'running',
  stage: 'transcribing',
  progress: 0.5,
  message: 'x',
  error: null,
  result: null,
  ...over,
});
const result = { language: 'es', duration_ms: 1000, mode: 'transcribed', engine: { demo: false }, lines: [], breaks: [], overall_confidence: 1, warnings: [] };

describe('cleanServiceUrl', () => {
  it('acepta http(s) y normaliza a origen', () => {
    expect(cleanServiceUrl('http://localhost:8765/')).toBe('http://localhost:8765');
    expect(cleanServiceUrl(' https://ia.ejemplo.com/ruta?x=1 ')).toBe('https://ia.ejemplo.com');
  });
  it('rechaza esquemas peligrosos, credenciales y basura', () => {
    for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'ftp://x', 'http://user:pass@host', 'no es url', '', 'x'.repeat(300), 42, null]) {
      expect(cleanServiceUrl(bad)).toBeNull();
    }
  });
  it('un valor inválido en ajustes vuelve al predeterminado', () => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    const s = TestBed.inject(SettingsService);
    s.update('aiServiceUrl', 'javascript:alert(1)');
    expect(s.settings().aiServiceUrl).toBe('http://localhost:8765');
  });
});

describe('AiServiceClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: AiServiceClient;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
    client = TestBed.inject(AiServiceClient);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('crea el trabajo, informa del progreso y devuelve el resultado', async () => {
    const polls = [status({ progress: 0.2 }), status({ progress: 0.7 }), status({ state: 'done', stage: 'done', progress: 1, result })];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/jobs') && init?.method === 'POST') return json({ id: 'j1' }, 202);
      if (init?.method === 'DELETE') return json({}, 204);
      return json(polls.shift());
    });
    const seen: number[] = [];
    const res = await client.run(file(), opts, (s) => seen.push(s.progress), new AbortController().signal);
    expect(res.language).toBe('es');
    expect(seen).toEqual([0.2, 0.7, 1]);
  });

  it('el nombre real del archivo NO se envía y los derechos sí', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/jobs') ? json({ id: 'j1' }, 202) : init?.method === 'DELETE' ? json({}, 204) : json(status({ state: 'done', result })),
    );
    await client.run(file(), { ...opts, title: 'T' }, () => {}, new AbortController().signal);
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const form = (post[1] as RequestInit).body as FormData;
    expect((form.get('audio') as File).name).toBe('audio');
    expect(form.get('rights_confirmed')).toBe('true');
    expect(form.get('title')).toBe('T');
    expect(JSON.stringify([...form.keys()])).not.toContain('secreto');
  });

  it('servicio apagado → error "offline" con instrucciones', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(client.health()).rejects.toMatchObject({ code: 'offline', message: expect.stringContaining('ai-service/README.md') });
  });

  it('un 400 del servicio muestra su mensaje (p. ej. derechos no confirmados)', async () => {
    fetchMock.mockImplementation(() => json({ detail: 'Debes confirmar los derechos' }, 400));
    await expect(client.run(file(), opts, () => {}, new AbortController().signal)).rejects.toMatchObject({
      code: 'rejected',
      message: 'Debes confirmar los derechos',
    });
  });

  it('un error del trabajo se propaga con el mensaje del servidor', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/jobs') ? json({ id: 'j1' }, 202) : json(status({ state: 'error', error: 'El audio no es válido' })),
    );
    await expect(client.run(file(), opts, () => {}, new AbortController().signal)).rejects.toMatchObject({
      code: 'failed',
      message: 'El audio no es válido',
    });
  });

  it('cancelar avisa al servidor (DELETE) y lanza "cancelled"', async () => {
    const ac = new AbortController();
    const calls: string[] = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('http://localhost:8765', '')}`);
      if (url.endsWith('/jobs') && init?.method === 'POST') return json({ id: 'j1' }, 202);
      if (init?.method === 'DELETE') return json({}, 204);
      return json(status({ progress: 0.3 }));
    });
    const p = client.run(file(), opts, () => ac.abort(), ac.signal); // se cancela al primer progreso
    await expect(p).rejects.toBeInstanceOf(AiServiceError);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toContain('DELETE /jobs/j1');
  });
});
