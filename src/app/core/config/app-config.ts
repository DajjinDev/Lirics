/**
 * Configuración central de integraciones y comportamiento. Es código de frontend: NO contiene
 * secretos. La clave de YouTube Data API la introduce el usuario en la interfaz (ver README).
 */

/** Direcciones base de los proveedores externos (todas verificadas con peticiones reales). */
export const API_BASES = {
  youtube: 'https://www.googleapis.com/youtube/v3',
  lrclib: 'https://lrclib.net/api',
  itunes: 'https://itunes.apple.com',
  musicBrainz: 'https://musicbrainz.org/ws/2',
  coverArt: 'https://coverartarchive.org',
} as const;

/** País del catálogo de iTunes cuando el navegador no indica región. Configurable en Ajustes. */
export const DEFAULT_COUNTRY = 'CO';
/** Catálogo de respaldo si el país configurado no devuelve resultados. */
export const FALLBACK_COUNTRY = 'US';

export const SEARCH_CONFIG = {
  /** Espera tras la última pulsación antes de consultar el catálogo. */
  debounceMs: 650,
  minimumQueryLength: 3,
  maxResults: 10,
} as const;

export const OFFSET_CONFIG = {
  stepMs: 100,
  minMs: -10_000,
  maxMs: 10_000,
  defaultMs: 0,
} as const;

/** Pesos orientativos del motor de coincidencia (suman 100). Validar con pruebas reales. */
export const MATCHING_WEIGHTS = {
  title: 40,
  artist: 30,
  duration: 20,
  album: 10,
} as const;

/** Umbrales sobre una escala 0–100. NO son probabilidades estadísticas verificadas. */
export const MATCH_THRESHOLDS = {
  high: 90,
  probable: 75,
  uncertain: 60,
} as const;

/** Diferencia de duración (ms) bajo la cual una coincidencia se considera comprobada. */
export const DURATION_VERIFIED_MS = 6000;

/**
 * Límites de frecuencia aplicados en el cliente para respetar a los proveedores.
 * iTunes: documentación histórica ≈ 20 peticiones/min (se usa un margen).
 * MusicBrainz: política de 1 petición por segundo.
 */
export const RATE_LIMITS = {
  itunes: { max: 18, windowMs: 60_000 },
  musicBrainz: { max: 1, windowMs: 1100 },
} as const;
