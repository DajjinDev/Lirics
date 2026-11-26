import { inject, InjectionToken } from '@angular/core';
import { WantedTrack } from '../lyrics/track-matcher';
import { LyricsCandidate } from '../models/lyrics.models';
import { LrclibProvider } from './lrclib.provider';

/**
 * Contrato de un proveedor de letras. Añadir uno nuevo (p. ej. Musixmatch a
 * través de un backend con licencia) solo requiere implementar esta interfaz
 * y sustituir/ampliar la lista por defecto de LYRICS_PROVIDERS en app.config;
 * el resto de la app no cambia.
 */
export interface LyricsProvider {
  readonly id: string;
  readonly label: string;
  find(query: WantedTrack, signal?: AbortSignal): Promise<LyricsCandidate[]>;
}

export const LYRICS_PROVIDERS = new InjectionToken<LyricsProvider[]>('LYRICS_PROVIDERS', {
  providedIn: 'root',
  factory: () => [inject(LrclibProvider)],
});
