import { effect, Injectable, signal } from '@angular/core';

export type LyricAlignment = 'left' | 'center';
export type WordSyncPreference = 'auto' | 'approximate' | 'off';
export type MotionPreference = 'system' | 'reduced' | 'full';

/** Modos de visualización. "classic" es el principal (portada izquierda, letras derecha). */
export type ViewMode = 'classic' | 'cinematic' | 'karaoke' | 'minimal' | 'cover';
export const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'classic', label: 'Clásico', hint: 'Portada a la izquierda, letras a la derecha' },
  { id: 'cinematic', label: 'Cinematográfico', hint: 'Letras centradas y grandes, elementos mínimos' },
  { id: 'karaoke', label: 'Karaoke', hint: 'Resaltado por palabras con énfasis' },
  { id: 'minimal', label: 'Minimalista', hint: 'Composición limpia, sin efectos decorativos' },
  { id: 'cover', label: 'Portada', hint: 'La portada como protagonista' },
];

export type FontFamilyId = 'jakarta' | 'inter' | 'manrope' | 'sora' | 'dmsans';
/** Familias disponibles. Solo se descarga la elegida (carga bajo demanda desde Google Fonts). */
export const FONT_FAMILIES: { id: FontFamilyId; label: string; css: string; gf: string }[] = [
  { id: 'jakarta', label: 'Plus Jakarta Sans', css: "'Plus Jakarta Sans'", gf: 'Plus+Jakarta+Sans' },
  { id: 'inter', label: 'Inter', css: "'Inter'", gf: 'Inter' },
  { id: 'manrope', label: 'Manrope', css: "'Manrope'", gf: 'Manrope' },
  { id: 'sora', label: 'Sora', css: "'Sora'", gf: 'Sora' },
  { id: 'dmsans', label: 'DM Sans', css: "'DM Sans'", gf: 'DM+Sans' },
];

export interface PlayerSettings {
  /** Multiplicador del tamaño de letra (0.8–1.4). */
  lyricScale: number;
  lyricWeight: 500 | 600 | 700;
  alignment: LyricAlignment;
  /** Intensidad de los degradados del fondo (0–1). */
  ambientIntensity: number;
  /** Fondo con movimiento lento. */
  ambientMotion: boolean;
  /** Desenfoque de las líneas no activas. */
  blurInactive: boolean;
  /** Opacidad de las líneas secundarias (0.15–0.7). */
  secondaryOpacity: number;
  /** Velocidad de las transiciones (0.5 lenta – 1.5 rápida). */
  transitionSpeed: number;
  /**
   * auto: palabras reales si existen; approximate: reparto estimado cuando no
   * existen; off: solo resaltado por línea.
   */
  wordSync: WordSyncPreference;
  motion: MotionPreference;
  viewMode: ViewMode;
  fontFamily: FontFamilyId;
  /** Multiplicador del tamaño de la portada (0.7–1.3). */
  coverScale: number;
  /** País del catálogo de iTunes (2 letras, p. ej. CO). Vacío = el de tu navegador o el predeterminado. */
  country: string;
  /** URL del servicio de IA local (Estudio de sincronización). */
  aiServiceUrl: string;
  /** Clave propia de YouTube Data API v3 (opcional; se guarda solo en este navegador). */
  youtubeApiKey: string;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  lyricScale: 1,
  lyricWeight: 600,
  alignment: 'left',
  ambientIntensity: 0.85,
  ambientMotion: true,
  blurInactive: true,
  secondaryOpacity: 0.34,
  transitionSpeed: 1,
  wordSync: 'auto',
  motion: 'system',
  viewMode: 'classic',
  fontFamily: 'jakarta',
  coverScale: 1,
  aiServiceUrl: 'http://localhost:8765',
  country: '',
  youtubeApiKey: '',
};

const KEY = 'liriks.settings.v1';
const OFFSET_PREFIX = 'liriks.offset.';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* almacenamiento bloqueado: la app sigue funcionando sin persistir */
  }
}

/** Ajustes del usuario con persistencia local (sin servidor en la fase 1). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<PlayerSettings>(this.load());
  readonly systemReducedMotion = signal(false);

  constructor() {
    effect(() => safeSet(KEY, JSON.stringify(this.settings())));
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      this.systemReducedMotion.set(mq.matches);
      mq.addEventListener('change', (e) => this.systemReducedMotion.set(e.matches));
    }
  }

  /** true si deben evitarse animaciones complejas (preferencia del usuario o del sistema). */
  reducedMotion(): boolean {
    const m = this.settings().motion;
    return m === 'reduced' || (m === 'system' && this.systemReducedMotion());
  }

  update<K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]): void {
    // Todo valor pasa por sanitize(): rangos válidos y tipos correctos.
    this.settings.update((s) => sanitize({ ...s, [key]: value }));
  }

  /** Pasa al siguiente modo de visualización y devuelve su etiqueta. */
  cycleViewMode(): string {
    const i = VIEW_MODES.findIndex((m) => m.id === this.settings().viewMode);
    const next = VIEW_MODES[(i + 1) % VIEW_MODES.length];
    this.update('viewMode', next.id);
    return next.label;
  }

  reset(): void {
    // La clave de API es una credencial del usuario, no una preferencia visual.
    this.settings.update((s) => ({ ...DEFAULT_SETTINGS, youtubeApiKey: s.youtubeApiKey }));
  }

  /* ---- Ajuste de sincronización por canción/versión ---- */
  getOffset(versionKey: string): number {
    const n = Number(safeGet(OFFSET_PREFIX + versionKey));
    return Number.isFinite(n) ? n : 0;
  }
  saveOffset(versionKey: string, ms: number): void {
    safeSet(OFFSET_PREFIX + versionKey, ms === 0 ? null : String(ms));
  }

  private load(): PlayerSettings {
    const raw = safeGet(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
      return sanitize(parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}

/** Código de país de 2 letras (A–Z) o null. */
export function cleanCountry(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** Solo http(s) sin credenciales ni rutas; sin barra final. null si no es válida. */
export function cleanServiceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  try {
    const u = new URL(value.trim());
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

const clamp = (n: unknown, lo: number, hi: number, d: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;

/** Valida lo leído de localStorage: nada que venga de fuera se usa sin comprobar. */
export function sanitize(p: Partial<PlayerSettings>): PlayerSettings {
  const d = DEFAULT_SETTINGS;
  return {
    lyricScale: clamp(p.lyricScale, 0.8, 1.4, d.lyricScale),
    lyricWeight: p.lyricWeight === 500 || p.lyricWeight === 700 ? p.lyricWeight : 600,
    alignment: p.alignment === 'center' ? 'center' : 'left',
    ambientIntensity: clamp(p.ambientIntensity, 0, 1, d.ambientIntensity),
    ambientMotion: typeof p.ambientMotion === 'boolean' ? p.ambientMotion : d.ambientMotion,
    blurInactive: typeof p.blurInactive === 'boolean' ? p.blurInactive : d.blurInactive,
    secondaryOpacity: clamp(p.secondaryOpacity, 0.15, 0.7, d.secondaryOpacity),
    transitionSpeed: clamp(p.transitionSpeed, 0.5, 1.5, d.transitionSpeed),
    wordSync: p.wordSync === 'approximate' || p.wordSync === 'off' ? p.wordSync : 'auto',
    motion: p.motion === 'reduced' || p.motion === 'full' ? p.motion : 'system',
    viewMode: VIEW_MODES.some((m) => m.id === p.viewMode) ? (p.viewMode as ViewMode) : 'classic',
    fontFamily: FONT_FAMILIES.some((f) => f.id === p.fontFamily) ? (p.fontFamily as FontFamilyId) : 'jakarta',
    coverScale: clamp(p.coverScale, 0.7, 1.3, d.coverScale),
    aiServiceUrl: cleanServiceUrl(p.aiServiceUrl) ?? d.aiServiceUrl,
    country: cleanCountry(p.country) ?? '',
    youtubeApiKey: typeof p.youtubeApiKey === 'string' ? p.youtubeApiKey.trim().slice(0, 100) : '',
  };
}
