import { inject, Injectable } from '@angular/core';
import { ServiceResult } from '../lyrics/lyrics-editor';
import { SettingsService } from '../services/settings.service';

export interface AiHealth {
  status: 'ok';
  backend: string; // "whisperx" | "fake"
  ffmpeg: boolean;
  whisperx: boolean;
  demucs: boolean;
  device: string | null;
  limits: { max_upload_mb: number; max_duration_s: number; max_lyrics_chars: number };
}

export type AiStage = 'queued' | 'validating' | 'preparing' | 'separating' | 'transcribing' | 'aligning' | 'building' | 'done';

export interface AiJobStatus {
  id: string;
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  stage: AiStage;
  progress: number;
  message: string;
  error: string | null;
  result: ServiceResult | null;
}

export interface AiJobOptions {
  rightsConfirmed: boolean;
  language?: string;
  lyricsText?: string;
  separateVocals: boolean;
  modelSize: string;
  title?: string;
  artist?: string;
}

export class AiServiceError extends Error {
  constructor(
    readonly code: 'offline' | 'rejected' | 'failed' | 'cancelled',
    message: string,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

const POLL_MS = 700;

/**
 * Cliente del servicio de IA OPCIONAL (ai-service/). Si no está en marcha, el resto de Liriks
 * sigue funcionando; el Estudio ofrece entonces la sincronización manual.
 * El audio solo se envía a la URL configurada por el usuario (por defecto, su propia máquina).
 */
@Injectable({ providedIn: 'root' })
export class AiServiceClient {
  private readonly settings = inject(SettingsService);

  get baseUrl(): string {
    return this.settings.settings().aiServiceUrl;
  }

  async health(signal?: AbortSignal): Promise<AiHealth> {
    const res = await this.fetch('/health', { signal: this.withTimeout(signal, 4000) });
    return (await res.json()) as AiHealth;
  }

  /** Crea el trabajo, sondea su progreso y devuelve el resultado. Cancelar `signal` cancela el trabajo. */
  async run(
    file: File,
    o: AiJobOptions,
    onProgress: (s: AiJobStatus) => void,
    signal: AbortSignal,
  ): Promise<ServiceResult> {
    const form = new FormData();
    form.set('audio', file, 'audio'); // el nombre real no se envía
    form.set('rights_confirmed', String(o.rightsConfirmed));
    form.set('separate_vocals', String(o.separateVocals));
    form.set('model_size', o.modelSize);
    if (o.language) form.set('language', o.language);
    if (o.lyricsText?.trim()) form.set('lyrics_text', o.lyricsText);
    if (o.title) form.set('title', o.title);
    if (o.artist) form.set('artist', o.artist);

    const created = await this.fetch('/jobs', { method: 'POST', body: form, signal });
    const { id } = (await created.json()) as { id: string };

    try {
      for (;;) {
        if (signal.aborted) throw new AiServiceError('cancelled', 'Cancelado.');
        const res = await this.fetch(`/jobs/${id}`, { signal });
        const st = (await res.json()) as AiJobStatus;
        onProgress(st);
        if (st.state === 'done' && st.result) {
          void this.delete(id);
          return st.result;
        }
        if (st.state === 'error') throw new AiServiceError('failed', st.error ?? 'El servicio no pudo procesar el audio.');
        if (st.state === 'cancelled') throw new AiServiceError('cancelled', 'Cancelado.');
        await sleep(POLL_MS, signal);
      }
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        void this.delete(id); // avisa al servidor para que detenga el trabajo
        throw new AiServiceError('cancelled', 'Cancelado.');
      }
      throw e;
    }
  }

  private async delete(id: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/jobs/${id}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  }

  private withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
    const t = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, t]) : t;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      if (init.signal?.aborted) throw e;
      throw new AiServiceError(
        'offline',
        `No se pudo conectar con el servicio de IA en ${this.baseUrl}. ¿Está en marcha? (consulta ai-service/README.md)`,
      );
    }
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body.detail === 'string') detail = body.detail;
      } catch {
        /* sin cuerpo JSON */
      }
      throw new AiServiceError(
        res.status >= 400 && res.status < 500 ? 'rejected' : 'failed',
        detail || `El servicio respondió con un error (${res.status}).`,
      );
    }
    return res;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Cancelado', 'AbortError'));
      },
      { once: true },
    );
  });
}
