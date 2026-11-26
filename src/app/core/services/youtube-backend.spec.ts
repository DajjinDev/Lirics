import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerErrorCode, PlayerState } from '../models/music.models';
import { PlaybackService } from './playback.service';
import { YouTubeBackend } from './youtube-backend';

/* --------------------------- IFrame API simulada --------------------------- */

type Cfg = {
  playerVars: Record<string, unknown>;
  videoId: string;
  events: {
    onReady: () => void;
    onStateChange: (e: { data: number }) => void;
    onError: (e: { data: number }) => void;
    onPlaybackRateChange: (e: { data: number }) => void;
  };
};

class FakePlayer {
  static instances: FakePlayer[] = [];
  calls: string[] = [];
  time = 0;
  duration = 200;
  volume = 80;
  muted = false;
  rate = 1;
  constructor(
    public el: HTMLElement,
    public cfg: Cfg,
  ) {
    FakePlayer.instances.push(this);
    queueMicrotask(() => cfg.events.onReady()); // la API real avisa de forma asíncrona
  }
  playVideo() { this.calls.push('play'); }
  pauseVideo() { this.calls.push('pause'); }
  stopVideo() { this.calls.push('stop'); }
  seekTo(s: number, ahead: boolean) { this.calls.push(`seek:${s}:${ahead}`); }
  setVolume(v: number) { this.volume = v; this.calls.push(`vol:${v}`); }
  getVolume() { return this.volume; }
  mute() { this.muted = true; this.calls.push('mute'); }
  unMute() { this.muted = false; this.calls.push('unmute'); }
  isMuted() { return this.muted; }
  getCurrentTime() { return this.time; }
  getDuration() { return this.duration; }
  getPlaybackRate() { return this.rate; }
  loadVideoById(id: string) { this.calls.push(`load:${id}`); }
  cueVideoById(id: string) { this.calls.push(`cue:${id}`); }
  destroy() { this.calls.push('destroy'); }
}

const w = window as unknown as { YT?: unknown; onYouTubeIframeAPIReady?: () => void };

function makeEvents() {
  const states: PlayerState[] = [];
  const errors: { code: PlayerErrorCode; message: string }[] = [];
  const rates: number[] = [];
  return {
    states,
    errors,
    rates,
    events: {
      state: (s: PlayerState) => states.push(s),
      error: (code: PlayerErrorCode, message: string) => errors.push({ code, message }),
      rate: (r: number) => rates.push(r),
    },
  };
}

async function started() {
  const host = document.createElement('div');
  const rec = makeEvents();
  const backend = new YouTubeBackend(host, rec.events);
  await backend.load({ videoId: 'dQw4w9WgXcQ' });
  const player = FakePlayer.instances[FakePlayer.instances.length - 1];
  return { host, backend, player, ...rec };
}

describe('YouTubeBackend', () => {
  beforeEach(() => {
    FakePlayer.instances = [];
    w.YT = { Player: FakePlayer };
  });
  afterEach(() => {
    delete w.YT;
    delete w.onYouTubeIframeAPIReady;
    vi.restoreAllMocks();
  });

  it('crea el reproductor con el origen de la página y lo deja listo', async () => {
    const { player, states } = await started();
    expect(player.cfg.videoId).toBe('dQw4w9WgXcQ');
    expect(player.cfg.playerVars['origin']).toBe(location.origin);
    expect(player.cfg.playerVars['enablejsapi']).toBe(1);
    expect(states).toEqual(['LOADING', 'READY']);
    expect(player.calls).toContain('play'); // intenta reproducir; si el navegador lo bloquea, la UI ofrece el botón
  });

  it('normaliza los estados de YouTube', async () => {
    const { player, states } = await started();
    states.length = 0;
    for (const code of [1, 2, 3, 0, 5, -1]) player.cfg.events.onStateChange({ data: code });
    expect(states).toEqual(['PLAYING', 'PAUSED', 'BUFFERING', 'ENDED', 'READY', 'READY']);
  });

  it('traduce los errores a códigos y mensajes comprensibles', async () => {
    const { player, errors } = await started();
    for (const code of [2, 100, 101, 150, 153, 5]) player.cfg.events.onError({ data: code });
    expect(errors.map((e) => e.code)).toEqual(['INVALID_PARAM', 'NOT_FOUND', 'NOT_EMBEDDABLE', 'NOT_EMBEDDABLE', 'UNKNOWN', 'UNKNOWN']);
    expect(errors[2].message).toContain('fuera de YouTube');
    expect(errors.every((e) => !/\b(101|150)\b/.test(e.message))).toBe(true); // sin códigos técnicos
  });

  it('delega los controles y convierte unidades (ms ↔ s)', async () => {
    const { backend, player } = await started();
    player.time = 12.5;
    player.duration = 213.4;
    expect(backend.getCurrentTimeMs()).toBe(12_500);
    expect(backend.getDurationMs()).toBeCloseTo(213_400);

    backend.seek(90_250);
    backend.pause();
    backend.stop();
    backend.setVolume(150); // se acota a 100
    backend.setMuted(true);
    backend.setMuted(false);
    backend.cue({ videoId: 'aaaaaaaaaaa' });
    expect(player.calls).toEqual(
      expect.arrayContaining(['seek:90.25:true', 'pause', 'stop', 'vol:100', 'mute', 'unmute', 'cue:aaaaaaaaaaa']),
    );
    expect(backend.getVolume()).toBe(100);
    expect(backend.isMuted()).toBe(false);
    player.rate = 1.5;
    expect(backend.getPlaybackRate()).toBe(1.5);
  });

  it('antes de estar listo devuelve valores neutros y no falla', () => {
    const backend = new YouTubeBackend(document.createElement('div'), makeEvents().events);
    expect(backend.getCurrentTimeMs()).toBe(0);
    expect(backend.getDurationMs()).toBe(0);
    expect(backend.getVolume()).toBe(0);
    expect(backend.getPlaybackRate()).toBe(1);
    expect(() => {
      backend.play();
      backend.pause();
      backend.seek(1000);
      backend.stop();
    }).not.toThrow();
  });

  it('reenvía los cambios de velocidad', async () => {
    const { player, rates } = await started();
    player.cfg.events.onPlaybackRateChange({ data: 2 });
    expect(rates).toEqual([2]);
  });

  it('cargar otro video reutiliza el reproductor', async () => {
    const { backend, player } = await started();
    await backend.load({ videoId: 'bbbbbbbbbbb' });
    expect(FakePlayer.instances).toHaveLength(1);
    expect(player.calls).toContain('load:bbbbbbbbbbb');
  });

  it('destroy libera el reproductor y el contenedor, y es idempotente', async () => {
    const { backend, player, host } = await started();
    host.appendChild(document.createElement('iframe'));
    backend.destroy();
    backend.destroy();
    expect(player.calls.filter((c) => c === 'destroy').length).toBeGreaterThanOrEqual(1);
    expect(host.childNodes.length).toBe(0);
  });

  it('exige un identificador de video', async () => {
    const backend = new YouTubeBackend(document.createElement('div'), makeEvents().events);
    await expect(backend.load({})).rejects.toMatchObject({ code: 'INVALID_PARAM' });
  });
});

describe('carga del SDK de YouTube', () => {
  beforeEach(() => {
    vi.resetModules();
    delete w.YT;
    delete w.onYouTubeIframeAPIReady;
    document.head.querySelectorAll('script[src*="youtube.com/iframe_api"]').forEach((s) => s.remove());
  });
  afterEach(() => {
    delete w.YT;
    delete w.onYouTubeIframeAPIReady;
    document.head.querySelectorAll('script[src*="youtube.com/iframe_api"]').forEach((s) => s.remove());
  });

  it('inyecta el script oficial UNA sola vez aunque se pida varias veces', async () => {
    const { loadYouTubeApi } = await import('./youtube-backend');
    const a = loadYouTubeApi();
    const b = loadYouTubeApi();
    expect(document.head.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1);
    w.YT = { Player: FakePlayer };
    w.onYouTubeIframeAPIReady!();
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
  });

  it('si el SDK ya está disponible no vuelve a cargar nada', async () => {
    const { loadYouTubeApi } = await import('./youtube-backend');
    w.YT = { Player: FakePlayer };
    await loadYouTubeApi();
    expect(document.head.querySelectorAll('script[src*="youtube.com/iframe_api"]')).toHaveLength(0);
  });

  it('respeta un callback previo de la página', async () => {
    const { loadYouTubeApi } = await import('./youtube-backend');
    const previous = vi.fn();
    w.onYouTubeIframeAPIReady = previous;
    const p = loadYouTubeApi();
    w.YT = { Player: FakePlayer };
    w.onYouTubeIframeAPIReady!();
    await p;
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('un fallo de carga (bloqueador de contenido, sin red) da un error claro y permite reintentar', async () => {
    const { loadYouTubeApi } = await import('./youtube-backend');
    const p = loadYouTubeApi();
    (document.head.querySelector('script[src*="youtube.com/iframe_api"]') as HTMLScriptElement).onerror!(new Event('error'));
    await expect(p).rejects.toMatchObject({ code: 'API_LOAD_FAILED' });
    // tras el fallo se puede volver a intentar (inyecta de nuevo)
    void loadYouTubeApi().catch(() => {});
    expect(document.head.querySelectorAll('script[src*="youtube.com/iframe_api"]').length).toBeGreaterThanOrEqual(1);
  });
});

describe('PlaybackService + YouTube: velocidad y reloj', () => {
  beforeEach(() => {
    FakePlayer.instances = [];
    w.YT = { Player: FakePlayer };
  });
  afterEach(() => {
    delete w.YT;
    vi.restoreAllMocks();
  });

  it('un cambio de velocidad recalibra el reloj interpolado que mueve las letras', async () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const svc = new PlaybackService();
    const host = document.createElement('div');
    await svc.load({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' }, host, 0);
    const player = FakePlayer.instances[0];

    player.cfg.events.onStateChange({ data: 1 }); // PLAYING
    expect(svc.state()).toBe('PLAYING');
    t += 1000;
    expect(svc.now()).toBeCloseTo(1000, -1); // velocidad normal

    player.cfg.events.onPlaybackRateChange({ data: 2 });
    expect(svc.rate()).toBe(2);
    const before = svc.now();
    t += 1000;
    expect(svc.now() - before).toBeCloseTo(2000, -1); // ahora avanza al doble

    player.cfg.events.onStateChange({ data: 2 }); // PAUSED: el reloj se congela
    const frozen = svc.now();
    t += 5000;
    expect(svc.now()).toBe(frozen);
    svc.stop();
  });

  it('stopPlayback vuelve al inicio y detiene el reloj', async () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const svc = new PlaybackService();
    await svc.load({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' }, document.createElement('div'), 0);
    const player = FakePlayer.instances[0];
    player.cfg.events.onStateChange({ data: 1 });
    t += 3000;
    svc.stopPlayback();
    expect(player.calls).toContain('stop');
    t += 3000;
    expect(svc.now()).toBe(0);
    expect(svc.positionMs()).toBe(0);
    svc.stop();
  });
});
