import { inject, Injectable } from '@angular/core';
import { lrcToSyncedLyrics } from '../lyrics/lrc-parser';
import { lyricsfileToSyncedLyrics } from '../lyrics/lyricsfile-parser';
import { durationVerified, instrumentalConsensus, matchLevel, rankLyricsCandidates, WantedTrack } from '../lyrics/track-matcher';
import {
  LyricsCandidate,
  LyricsLoadResult,
  SyncedLyrics,
} from '../models/lyrics.models';
import { isAbort } from '../providers/http';
import { LYRICS_PROVIDERS } from '../providers/lyrics-provider';

/**
 * Busca letras en todos los proveedores registrados, las puntúa contra la
 * pista que SUENA y construye el modelo sincronizado. No decide qué mostrar
 * en pantalla: solo informa del resultado y su confianza.
 */
@Injectable({ providedIn: 'root' })
export class LyricsService {
  private readonly providers = inject(LYRICS_PROVIDERS);

  /** Recoge candidatos de todos los proveedores (los que fallen no impiden a los demás). */
  async fetchCandidates(wanted: WantedTrack, signal?: AbortSignal): Promise<LyricsCandidate[]> {
    const settled = await Promise.allSettled(this.providers.map((p) => p.find(wanted, signal)));
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const all: LyricsCandidate[] = [];
    let error: unknown;
    for (const s of settled) {
      if (s.status === 'fulfilled') all.push(...s.value);
      else if (!isAbort(s.reason)) error ??= s.reason;
    }
    if (all.length === 0 && error) throw error;
    return all;
  }

  /** Puntúa y decide el estado de las letras para una pista con una duración de referencia. */
  evaluate(
    trackId: string,
    wanted: WantedTrack,
    candidates: LyricsCandidate[],
    chosenId?: string,
  ): LyricsLoadResult {
    const ranked = rankLyricsCandidates(wanted, candidates);
    if (ranked.length === 0) {
      return { status: 'NOT_FOUND', alternatives: [], message: 'No encontramos letras para esta canción.' };
    }
    // Obra instrumental en todas sus grabaciones conocidas: no tiene letra, sea cual sea la versión.
    if (!chosenId && instrumentalConsensus(wanted, candidates)) {
      return {
        status: 'INSTRUMENTAL',
        alternatives: ranked,
        best: ranked[0],
        message: 'Esta obra figura como instrumental: no tiene letra.',
      };
    }
    const chosen = chosenId ? ranked.find((r) => r.candidate.externalId === chosenId) : undefined;
    const best = chosen ?? ranked[0];
    const level = matchLevel(best);

    // Sin elección del usuario, una coincidencia baja no se muestra como si fuera la canción.
    if (!chosen && level === 'insufficient') {
      return {
        status: 'NOT_FOUND',
        alternatives: ranked,
        best,
        message: 'No encontramos letras fiables para esta versión. Puedes revisar otras opciones.',
      };
    }

    if (best.candidate.instrumental) {
      return { status: 'INSTRUMENTAL', best, alternatives: ranked, message: 'Esta canción es instrumental.' };
    }

    const lyrics = this.toSynced(best.candidate, trackId, wanted.durationMs);
    if (lyrics) {
      // Sin aviso solo si es alta, o probable con la duración comprobada, o la eligió el usuario.
      const confirmed = !!chosen || level === 'high' || (level === 'probable' && durationVerified(best));
      return {
        status: confirmed ? 'FOUND_SYNCED' : 'MATCH_UNCERTAIN',
        lyrics,
        best,
        alternatives: ranked,
        message:
          confirmed
            ? undefined
            : 'No pudimos comprobar que estas letras correspondan exactamente a esta versión. Si ves un desfase, ajústalo o elige otra versión.',
      };
    }
    if (best.candidate.plainLyrics) {
      return {
        status: 'FOUND_PLAIN',
        plainLyrics: best.candidate.plainLyrics,
        best,
        alternatives: ranked,
        message: 'Solo existen letras sin sincronización para esta canción.',
      };
    }
    return { status: 'NOT_FOUND', alternatives: ranked, best, message: 'No encontramos letras para esta canción.' };
  }

  private toSynced(c: LyricsCandidate, trackId: string, durationMs?: number): SyncedLyrics | null {
    const base = { trackId, sourceName: c.providerId, durationMs: durationMs ?? c.durationMs };
    if (c.wordSyncedFile) {
      const w = lyricsfileToSyncedLyrics(c.wordSyncedFile, base);
      if (w) return w;
    }
    if (c.syncedLrc) {
      const l = lrcToSyncedLyrics(c.syncedLrc, base);
      if (l.synchronizationType !== 'none') return l;
    }
    return null;
  }
}
