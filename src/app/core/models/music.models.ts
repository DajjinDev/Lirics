export type TrackSource = 'itunes' | 'youtube';

/**
 * Identidad de una canción, normalizada entre proveedores. Los identificadores de cada proveedor
 * se mantienen SEPARADOS: el id de YouTube no es el identificador universal de la canción.
 */
export interface Track {
  /** Identificador de ruta: `itunes:<id>` o `yt:<videoId>`. Solo identifica la pista dentro de Liriks. */
  id: string;
  source: TrackSource;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  year?: number;
  releaseDate?: string;
  genre?: string;

  /* Identificadores por proveedor */
  videoId?: string;
  itunesTrackId?: number;
  musicBrainzId?: string;
  releaseId?: string;
  releaseGroupId?: string;
  isrc?: string;

  /** Portada en alta resolución (≥ 600 px cuando el proveedor la ofrece). */
  artworkUrl?: string;
  /** Miniatura para listas. */
  artworkThumbUrl?: string;
  /** Portada tal como la entrega el proveedor (documentada), por si la grande falla. */
  artworkFallbackUrl?: string;

  /** Nombre visible del proveedor del metadato. */
  providerLabel: string;
  /** De dónde salen los metadatos: itunes | youtube | musicbrainz. */
  metadataSource?: string;
}

export type SearchResult = Track;

/** Fuente de reproducción resuelta para una pista. */
export type PlaybackSource =
  | { kind: 'youtube'; videoId: string; title?: string; channel?: string; durationMs?: number }
  | { kind: 'demo' }
  /** Archivo de audio propio del usuario (object URL). */
  | { kind: 'local'; url: string; durationMs?: number };

export type PlayerState =
  | 'IDLE'
  | 'LOADING'
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'BUFFERING'
  | 'ENDED'
  | 'ERROR';

export type PlayerErrorCode =
  | 'NOT_EMBEDDABLE'
  | 'NOT_FOUND'
  | 'INVALID_PARAM'
  | 'AUTOPLAY_BLOCKED'
  | 'API_LOAD_FAILED'
  | 'UNKNOWN';

export type UiState =
  | 'HOME'
  | 'SEARCHING'
  | 'SEARCH_RESULTS'
  | 'PLAYER_LOADING'
  | 'PLAYER_READY'
  | 'PLAYER_ERROR';

/** Error de dominio con mensaje apto para mostrar al usuario. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = 'AppError';
  }
}
