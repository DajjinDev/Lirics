import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { PlaybackService } from '../../core/services/playback.service';
import { PlayerSessionService } from '../../core/services/player-session.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/icon.component';
import { SyncedLyricsComponent } from '../lyrics/synced-lyrics.component';
import { PlayerSettingsComponent } from '../settings/player-settings.component';
import { AlbumArtworkComponent } from './album-artwork.component';
import { LyricsVersionsComponent } from './lyrics-versions.component';
import { PlaybackControlsComponent } from './playback-controls.component';
import { ProgressBarComponent } from './progress-bar.component';
import { SyncAdjustComponent } from './sync-adjust.component';
import { VideoLinkFormComponent } from './video-link-form.component';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const IDLE_MS = 3500;

@Component({
  selector: 'app-player-page',
  imports: [
    IconComponent,
    AlbumArtworkComponent,
    PlaybackControlsComponent,
    ProgressBarComponent,
    SyncAdjustComponent,
    SyncedLyricsComponent,
    PlayerSettingsComponent,
    LyricsVersionsComponent,
    VideoLinkFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(pointermove)': 'wake()',
    '(pointerdown)': 'wake()',
    '(window:keydown)': 'onKey($event)',
  },
  templateUrl: './player.page.html',
  styleUrl: './player.page.scss',
})
export class PlayerPage {
  /** Parámetros de ruta enlazados como inputs (withComponentInputBinding). */
  readonly id = input.required<string>();
  readonly v = input<string | undefined>();

  protected readonly session = inject(PlayerSessionService);
  protected readonly playback = inject(PlaybackService);
  protected readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  private readonly ytHost = viewChild<ElementRef<HTMLElement>>('ytHost');
  private readonly settingsDlg = viewChild.required(PlayerSettingsComponent);
  private readonly versionsDlg = viewChild.required(LyricsVersionsComponent);

  protected readonly mode = computed(() => this.settings.settings().viewMode);
  /** Aviso breve y accesible (aria-live) del último cambio de modo. */
  protected readonly toast = signal<string | null>(null);
  /** Un array de un elemento: cambiar su clave recrea el bloque y re-lanza la animación de entrada. */
  protected readonly trackKey = computed(() => (this.session.track() ? [this.session.track()!.id] : []));
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly fullscreen = signal(false);
  protected readonly idle = signal(false);
  protected readonly canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

  private loadedKey = '';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Abrir la canción cuando cambian la ruta o el video indicado.
    effect(() => {
      const id = this.id();
      const v = this.v();
      untracked(() => {
        this.loadedKey = '';
        void this.session.open(id, v && VIDEO_ID.test(v) ? v : undefined);
      });
    });

    // Iniciar el reproductor cuando hay fuente (y contenedor, si es de YouTube).
    effect(() => {
      const src = this.session.source();
      const track = this.session.track();
      const host = this.ytHost();
      if (!src || !track) return;
      if (src.kind === 'youtube' && !host) return;
      const key = src.kind === 'youtube' ? `yt:${src.videoId}` : `demo:${track.id}`;
      if (key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => void this.playback.load(src, host?.nativeElement ?? null, track.durationMs ?? 200_000));
    });

    effect(() => {
      const t = this.session.track();
      this.title.setTitle(t ? `${t.title} — ${t.artist} · Liriks` : 'Liriks');
    });

    effect(() => this.syncMediaSession());

    const onFs = () => this.fullscreen.set(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFs);
      if (this.idleTimer) clearTimeout(this.idleTimer);
      if (this.toastTimer) clearTimeout(this.toastTimer);
      if (document.fullscreenElement) void document.exitFullscreen();
      this.title.setTitle('Liriks — la música, a través de sus letras');
      this.session.close();
    });

    // El indicador de inactividad solo aplica mientras suena la música.
    effect(() => {
      if (this.playback.isPlaying()) untracked(() => this.wake());
      else {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        untracked(() => this.idle.set(false));
      }
    });
  }

  protected wake(): void {
    if (this.idle()) this.idle.set(false);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.playback.isPlaying()) return;
    this.idleTimer = setTimeout(() => this.idle.set(true), IDLE_MS);
  }

  protected cycleMode(): void {
    const label = this.settings.cycleViewMode();
    this.toast.set(`Modo ${label.toLowerCase()}`);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 1800);
  }

  protected back(): void {
    void this.router.navigate(['/']);
  }

  protected openSettings(): void {
    this.settingsDlg().open();
  }
  protected openVersions(): void {
    this.versionsDlg().open();
  }

  protected attach(videoId: string): void {
    const t = this.session.track();
    if (!t) return;
    void this.router.navigate(['/play', t.id], { queryParams: { v: videoId } });
  }

  protected async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* el navegador lo rechazó (p. ej. sin gesto del usuario): no es crítico */
    }
  }

  protected onKey(e: KeyboardEvent): void {
    this.wake();
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const onButton = tag === 'BUTTON' || tag === 'A';

    switch (e.key) {
      case ' ':
        if (onButton) return; // el botón enfocado gestiona su propio Espacio
        e.preventDefault();
        this.playback.toggle();
        break;
      case 'ArrowLeft':
        this.playback.seekBy(-5000);
        break;
      case 'ArrowRight':
        this.playback.seekBy(5000);
        break;
      case 'm':
      case 'M':
        this.playback.toggleMute();
        break;
      case 'v':
      case 'V':
        this.cycleMode();
        break;
      case 'f':
      case 'F':
        if (this.canFullscreen) void this.toggleFullscreen();
        break;
    }
  }

  /** Metadatos y acciones del sistema (teclas multimedia, pantalla de bloqueo). */
  private syncMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const t = this.session.track();
    if (!t) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album ?? '',
      artwork: t.artworkUrl ? [{ src: t.artworkUrl, sizes: '1000x1000' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => this.playback.play());
    navigator.mediaSession.setActionHandler('pause', () => this.playback.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => this.playback.seekBy(-10000));
    navigator.mediaSession.setActionHandler('seekforward', () => this.playback.seekBy(10000));
  }
}
