import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, afterNextRender } from '@angular/core';
import { Router } from '@angular/router';
import {
  formatTimeInput,
  fromJsonText,
  fromLrcText,
  fromPlainText,
  fromServiceResult,
  insertAfter,
  mergeWithNext,
  nudge,
  parseTimeInput,
  removeLine,
  setStart,
  setText,
  shiftAll,
  sortByTime,
  StudioDoc,
  StudioLine,
  tapSync,
  toJson,
  toLrc,
  toSyncedLyrics,
  untimedCount,
  validate,
} from '../../core/lyrics/lyrics-editor';
import { AiHealth, AiServiceClient, AiServiceError } from '../../core/providers/ai-service.client';
import { PlaybackService } from '../../core/services/playback.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/icon.component';
import { SyncedLyricsComponent } from '../lyrics/synced-lyrics.component';
import { PlaybackControlsComponent } from '../player/playback-controls.component';
import { ProgressBarComponent } from '../player/progress-bar.component';

const MAX_HISTORY = 50;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;

/**
 * Estudio de sincronización (Fase 3). Flujo:
 *  1. Elegir un audio PROPIO o autorizado (se reproduce localmente; no se sube a ningún sitio).
 *  2. Opcional: pegar la letra o importar un .lrc/.json.
 *  3. Sincronizar con el servicio de IA local (si está en marcha) o a mano (tap-sync).
 *  4. Revisar/corregir línea por línea con vista previa y exportar LRC / JSON.
 */
@Component({
  selector: 'app-studio-page',
  imports: [IconComponent, ProgressBarComponent, PlaybackControlsComponent, SyncedLyricsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown)': 'onKey($event)' },
  templateUrl: './studio.page.html',
  styleUrl: './studio.page.scss',
})
export class StudioPage {
  protected readonly playback = inject(PlaybackService);
  protected readonly ai = inject(AiServiceClient);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);

  /* ---- audio ---- */
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly dragging = signal(false);
  private fileUrl: string | null = null;

  /* ---- letra y metadatos ---- */
  protected readonly lyricsText = signal('');
  protected readonly title = signal('');
  protected readonly artist = signal('');
  protected readonly importError = signal<string | null>(null);

  /* ---- servicio de IA ---- */
  protected readonly health = signal<AiHealth | null>(null);
  protected readonly serviceError = signal<string | null>(null);
  protected readonly checking = signal(false);
  protected readonly rights = signal(false);
  protected readonly separate = signal(false);
  protected readonly language = signal('');
  protected readonly model = signal('small');
  protected readonly running = signal(false);
  protected readonly progress = signal(0);
  protected readonly stageMsg = signal('');
  protected readonly jobError = signal<string | null>(null);
  private abort: AbortController | null = null;

  /* ---- documento y edición ---- */
  protected readonly doc = signal<StudioDoc | null>(null);
  private history: StudioDoc[] = [];
  protected readonly canUndo = signal(false);
  protected readonly tab = signal<'edit' | 'preview'>('edit');
  protected readonly flash = signal<string | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly serviceUrl = computed(() => this.settings.settings().aiServiceUrl);
  protected readonly untimed = computed(() => (this.doc() ? untimedCount(this.doc()!) : 0));
  protected readonly issues = computed(() => {
    const d = this.doc();
    return d ? new Map(validate(d).filter((i) => i.kind !== 'untimed').map((i) => [i.lineId, i.message])) : new Map<string, string>();
  });
  protected readonly preview = computed(() => {
    const d = this.doc();
    if (!d) return null;
    const s = toSyncedLyrics(d);
    return s.synchronizationType === 'none' ? null : s;
  });
  /** Línea que suena ahora (por la posición gruesa del reproductor). */
  protected readonly activeId = computed(() => {
    const d = this.doc();
    if (!d) return null;
    const pos = this.playback.positionMs();
    let id: string | null = null;
    let best = -1;
    for (const l of d.lines) {
      if (l.startMs !== null && l.startMs <= pos && l.startMs > best) {
        best = l.startMs;
        id = l.id;
      }
    }
    return id;
  });
  protected readonly tooBig = computed(() => {
    const f = this.file();
    const h = this.health();
    return !!f && !!h && f.size > h.limits.max_upload_mb * 1024 * 1024;
  });
  protected readonly canRunAi = computed(
    () => !!this.file() && this.rights() && !!this.health() && !this.running() && !this.tooBig(),
  );
  protected readonly isDemoService = computed(() => this.health()?.backend === 'fake');

  protected readonly languages = [
    { code: '', label: 'Detectar automáticamente' },
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'Inglés' },
    { code: 'pt', label: 'Portugués' },
    { code: 'fr', label: 'Francés' },
    { code: 'it', label: 'Italiano' },
    { code: 'de', label: 'Alemán' },
    { code: 'ko', label: 'Coreano' },
    { code: 'ja', label: 'Japonés' },
  ];
  protected readonly models = ['tiny', 'base', 'small', 'medium', 'large-v3'];
  protected readonly fmt = formatTimeInput;

  constructor() {
    afterNextRender(() => void this.checkService());
    inject(DestroyRef).onDestroy(() => {
      this.abort?.abort();
      this.playback.stop();
      if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
      if (this.flashTimer) clearTimeout(this.flashTimer);
    });
  }

  protected back(): void {
    void this.router.navigate(['/']);
  }

  /* ------------------------------------------------------------------ servicio */

  protected async checkService(): Promise<void> {
    this.checking.set(true);
    this.serviceError.set(null);
    try {
      this.health.set(await this.ai.health());
    } catch (e) {
      this.health.set(null);
      this.serviceError.set(e instanceof Error ? e.message : 'No se pudo comprobar el servicio.');
    } finally {
      this.checking.set(false);
    }
  }

  protected setServiceUrl(e: Event): void {
    this.settings.update('aiServiceUrl', (e.target as HTMLInputElement).value);
    void this.checkService();
  }

  protected async runAi(): Promise<void> {
    const f = this.file();
    if (!f || !this.canRunAi()) return;
    this.abort = new AbortController();
    this.running.set(true);
    this.progress.set(0);
    this.stageMsg.set('Enviando el audio al servicio…');
    this.jobError.set(null);
    try {
      const result = await this.ai.run(
        f,
        {
          rightsConfirmed: this.rights(),
          language: this.language() || undefined,
          lyricsText: this.lyricsText(),
          separateVocals: this.separate(),
          modelSize: this.model(),
          title: this.title() || undefined,
          artist: this.artist() || undefined,
        },
        (st) => {
          this.progress.set(st.progress);
          this.stageMsg.set(st.message);
        },
        this.abort.signal,
      );
      this.commit(fromServiceResult(result));
      this.tab.set('edit');
      this.notify('Sincronización lista. Revísala y corrige lo que haga falta.');
    } catch (e) {
      if (e instanceof AiServiceError && e.code === 'cancelled') this.notify('Procesamiento cancelado.');
      else this.jobError.set(e instanceof Error ? e.message : 'No se pudo completar el procesamiento.');
    } finally {
      this.running.set(false);
    }
  }

  protected cancelAi(): void {
    this.abort?.abort();
  }

  /* ------------------------------------------------------------------ audio y letra */

  protected onAudioInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.setAudio(f);
    input.value = '';
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.setAudio(f);
  }

  private setAudio(f: File): void {
    if (!f.type.startsWith('audio/') && !AUDIO_EXT.test(f.name)) {
      this.fileError.set('Ese archivo no parece un audio. Usa MP3, WAV, M4A, OGG, FLAC o similar.');
      return;
    }
    this.fileError.set(null);
    this.jobError.set(null);
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(f);
    this.file.set(f);
    if (!this.title()) this.title.set(f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '));
    void this.playback.load({ kind: 'local', url: this.fileUrl }, null, 0);
  }

  protected onLyricsFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.importError.set(null);
    if (f.size > 2 * 1024 * 1024) {
      this.importError.set('El archivo de letras es demasiado grande.');
      return;
    }
    void f.text().then((text) => {
      try {
        const dur = this.playback.durationMs();
        if (/\.json$/i.test(f.name)) this.commit(fromJsonText(text));
        else if (/\.lrc$/i.test(f.name)) this.commit(fromLrcText(text, dur));
        else this.lyricsText.set(text);
        this.tab.set('edit');
      } catch (err) {
        this.importError.set(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
      }
    });
  }

  protected useManual(): void {
    const text = this.lyricsText().trim();
    if (!text) {
      this.importError.set('Pega primero la letra para poder sincronizarla a mano.');
      return;
    }
    this.importError.set(null);
    this.commit(fromPlainText(text, this.playback.durationMs()));
    this.tab.set('edit');
    this.notify('Reproduce el audio y pulsa T justo cuando empiece cada línea.');
  }

  /* ------------------------------------------------------------------ edición */

  /** Aplica un cambio guardando el estado anterior para poder deshacer. */
  private commit(next: StudioDoc): void {
    const prev = this.doc();
    if (prev) {
      this.history.push(prev);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.canUndo.set(this.history.length > 0);
    this.doc.set(next);
  }

  private edit(fn: (d: StudioDoc) => StudioDoc): void {
    const d = this.doc();
    if (d) this.commit(fn(d));
  }

  protected undo(): void {
    const prev = this.history.pop();
    if (prev) this.doc.set(prev);
    this.canUndo.set(this.history.length > 0);
  }

  protected seekTo(l: StudioLine): void {
    if (l.startMs === null) return;
    this.playback.seek(Math.max(0, l.startMs - 400));
    this.playback.play();
  }

  protected markNow(l: StudioLine): void {
    this.edit((d) => setStart(d, l.id, this.playback.now()));
  }

  protected tap(): void {
    const d = this.doc();
    if (!d) return;
    const { doc, id } = tapSync(d, this.playback.now());
    if (id) {
      this.commit(doc);
      document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'center', behavior: this.settings.reducedMotion() ? 'auto' : 'smooth' });
    } else {
      this.notify('No quedan líneas sin tiempo.');
    }
  }

  protected onTime(l: StudioLine, e: Event): void {
    const el = e.target as HTMLInputElement;
    const ms = parseTimeInput(el.value);
    if (ms === null) {
      el.value = formatTimeInput(l.startMs); // valor no válido: se restaura
      this.notify('Tiempo no válido. Usa el formato 1:23.45');
      return;
    }
    this.edit((d) => setStart(d, l.id, ms));
  }

  protected onText(l: StudioLine, e: Event): void {
    this.edit((d) => setText(d, l.id, (e.target as HTMLInputElement).value));
  }

  protected nudgeLine(l: StudioLine, delta: number): void {
    this.edit((d) => nudge(d, l.id, delta));
  }
  protected shiftEverything(delta: number): void {
    this.edit((d) => shiftAll(d, delta));
  }
  protected addAfter(l: StudioLine): void {
    this.edit((d) => insertAfter(d, l.id));
  }
  protected remove(l: StudioLine): void {
    this.edit((d) => removeLine(d, l.id));
  }
  protected merge(l: StudioLine): void {
    this.edit((d) => mergeWithNext(d, l.id));
  }
  protected sort(): void {
    this.edit(sortByTime);
  }

  protected confidenceLabel(l: StudioLine): string {
    return l.confidence === undefined ? '' : `${Math.round(l.confidence * 100)} %`;
  }
  protected isLow(l: StudioLine): boolean {
    return (l.confidence ?? 1) < 0.5;
  }
  protected flagText(l: StudioLine): string {
    const names: Record<string, string> = {
      low_confidence: 'baja confianza',
      interpolated_words: 'palabras con tiempo estimado',
      fast_speech: 'ritmo muy rápido',
      in_silence: 'cae sobre un tramo sin voz',
      repetition: 'línea repetida',
    };
    return (l.flags ?? []).map((f) => names[f] ?? f).join(', ');
  }

  /* ------------------------------------------------------------------ exportación */

  protected exportAs(kind: 'lrc' | 'lrc-enhanced' | 'json'): void {
    const d = this.doc();
    if (!d) return;
    const meta = { title: this.title() || undefined, artist: this.artist() || undefined };
    const base = (this.title() || 'letra').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'letra';
    if (kind === 'json') this.download(`${base}.json`, toJson(d, meta), 'application/json');
    else this.download(`${base}.lrc`, toLrc(d, { enhanced: kind === 'lrc-enhanced', ...meta }), 'text/plain');
    if (kind !== 'json' && this.untimed() > 0) this.notify(`${this.untimed()} línea(s) sin tiempo no se incluyen en el LRC.`);
  }

  private download(name: string, content: string, mime: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------------ varios */

  private notify(msg: string): void {
    this.flash.set(msg);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 4500);
  }

  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      this.tap();
    } else if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault();
      this.playback.toggle();
    }
  }
}
