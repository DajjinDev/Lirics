import {
  LyricsCandidate,
  MatchLevel,
  ScoredLyricsCandidate,
} from '../models/lyrics.models';
import { DURATION_VERIFIED_MS, MATCHING_WEIGHTS, MATCH_THRESHOLDS } from '../config/app-config';
import {
  artistSimilarity,
  cleanChannelName,
  detectVersionFlags,
  normalizeForCompare,
  titleSimilarity,
  VersionFlag,
} from './text-normalize';

/** Lo que queremos encontrar (la pista seleccionada por el usuario). */
export interface WantedTrack {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Pesos normalizados a 0–1 a partir de la configuración (suman 1). */
const W = {
  title: MATCHING_WEIGHTS.title / 100,
  artist: MATCHING_WEIGHTS.artist / 100,
  duration: MATCHING_WEIGHTS.duration / 100,
  album: MATCHING_WEIGHTS.album / 100,
};
/** Bono máximo por tener mejores datos de sincronía; va dentro del margen del 100 %. */
const SYNC_BONUS = { word: 0.03, line: 0.015 };

/** Puntaje de cercanía de duración: 1 = idéntica, 0 = incompatible. */
export function durationScore(deltaMs: number): number {
  const d = Math.abs(deltaMs);
  if (d <= 1500) return 1;
  if (d <= 3000) return 0.9;
  if (d <= 6000) return 0.65;
  if (d <= 12000) return 0.3;
  return 0;
}

function flagDifference(a: Set<VersionFlag>, b: Set<VersionFlag>): VersionFlag[] {
  const diff: VersionFlag[] = [];
  for (const f of a) if (!b.has(f)) diff.push(f);
  for (const f of b) if (!a.has(f)) diff.push(f);
  return diff;
}

/**
 * Puntúa un candidato de letras frente a la pista deseada. La duración que se
 * compara debe ser la de la grabación que SUENA (el reproductor la conoce
 * mejor que ningún catálogo); si no se sabe, la confianza se limita.
 */
export function scoreLyricsCandidate(
  wanted: WantedTrack,
  cand: LyricsCandidate,
): ScoredLyricsCandidate {
  const reasons: string[] = [];
  const title = titleSimilarity(wanted.title, cand.trackName);
  const artist = artistSimilarity(wanted.artist, cand.artistName);
  const album =
    wanted.album && cand.albumName
      ? titleSimilarity(wanted.album, cand.albumName)
      : undefined;

  let durationDeltaMs: number | undefined;
  let dur: number | undefined;
  if (wanted.durationMs && cand.durationMs) {
    durationDeltaMs = cand.durationMs - wanted.durationMs;
    dur = durationScore(durationDeltaMs);
  }

  // Solo cuentan los criterios sobre los que hay datos; el resultado se normaliza por sus pesos.
  let score = title * W.title + artist * W.artist;
  let weight = W.title + W.artist;
  if (dur !== undefined) {
    score += dur * W.duration;
    weight += W.duration;
  }
  if (album !== undefined) {
    score += album * W.album;
    weight += W.album;
  }
  let confidence = score / weight;
  let versionMismatch = false;

  // Versiones alternativas: si una es live/remix/etc. y la otra no, se penaliza.
  const wantedFlags = detectVersionFlags(`${wanted.title} ${wanted.album ?? ''}`);
  const candFlags = detectVersionFlags(`${cand.trackName} ${cand.albumName ?? ''}`);
  const diff = flagDifference(wantedFlags, candFlags);
  if (diff.length > 0) {
    confidence -= 0.25;
    versionMismatch = true;
    reasons.push(`versión distinta (${diff.join(', ')})`);
  }

  // Preferir datos mejores cuando el resto empata. Va ANTES de los topes para
  // que ningún bono pueda saltarse una limitación.
  if (cand.wordSyncedFile) confidence += SYNC_BONUS.word;
  else if (cand.syncedLrc) confidence += SYNC_BONUS.line;

  if (title < 0.6) reasons.push('título poco parecido');
  if (artist < 0.6) reasons.push('artista poco parecido');
  if (durationDeltaMs !== undefined && Math.abs(durationDeltaMs) > DURATION_VERIFIED_MS) {
    reasons.push(`duración difiere ${(Math.abs(durationDeltaMs) / 1000).toFixed(0)} s`);
  }

  // Topes: una pista con otro artista o título no es "casi" la misma.
  // Otra versión (live, remix…) nunca supera "incierta": que coincida la duración no prueba que sea la misma.
  // Va DESPUÉS del bono de sincronía para que ningún bono pueda saltarse la limitación.
  if (versionMismatch) confidence = Math.min(confidence, (MATCH_THRESHOLDS.probable - 1) / 100);
  if (artist < 0.5) confidence = Math.min(confidence, 0.4);
  if (title < 0.5) confidence = Math.min(confidence, 0.35);
  // Duración muy distinta: no puede considerarse coincidencia exacta.
  if (durationDeltaMs !== undefined && Math.abs(durationDeltaMs) > 15000) {
    confidence = Math.min(confidence, 0.5);
  }
  // Sin duración de referencia no se puede afirmar que sea la misma versión: como mucho "probable".
  if (dur === undefined) confidence = Math.min(confidence, (MATCH_THRESHOLDS.high - 1) / 100 - 0.0001);

  return { candidate: cand, confidence: clamp01(confidence), durationDeltaMs, reasons };
}

/** Puntuación 0–100 (entera) para mostrar al usuario. */
export function matchScore(scored: ScoredLyricsCandidate): number {
  return Math.round(scored.confidence * 100);
}

/** true si la duración de la letra coincide con la de la grabación que suena (comprobada). */
export function durationVerified(scored: ScoredLyricsCandidate): boolean {
  const d = scored.durationDeltaMs;
  return d !== undefined && Math.abs(d) <= DURATION_VERIFIED_MS;
}

/**
 * 90–100 alta · 75–89 probable · 60–74 incierta · 0–59 insuficiente.
 * "Alta" exige además haber comprobado la duración: sin ella no se afirma que sea la versión exacta.
 */
export function matchLevel(scored: ScoredLyricsCandidate): MatchLevel {
  const s = matchScore(scored);
  if (s >= MATCH_THRESHOLDS.high && durationVerified(scored)) return 'high';
  if (s >= MATCH_THRESHOLDS.probable) return 'probable';
  if (s >= MATCH_THRESHOLDS.uncertain) return 'uncertain';
  return 'insufficient';
}

/**
 * true si la obra figura como INSTRUMENTAL en todas las grabaciones que coinciden en título y
 * artista (al menos 2). Una obra instrumental no tiene letra aunque no se sepa qué versión suena,
 * así que aquí no hace falta comprobar la duración.
 */
export function instrumentalConsensus(wanted: WantedTrack, candidates: LyricsCandidate[]): boolean {
  const same = candidates.filter(
    (c) => titleSimilarity(wanted.title, c.trackName) >= 0.8 && artistSimilarity(wanted.artist, c.artistName) >= 0.8,
  );
  return same.length >= 2 && same.every((c) => c.instrumental);
}

/** Ordena candidatos: mayor confianza primero; empates → con sincronía por palabra, luego por línea. */
export function rankLyricsCandidates(
  wanted: WantedTrack,
  candidates: LyricsCandidate[],
): ScoredLyricsCandidate[] {
  const rank = (c: LyricsCandidate) => (c.wordSyncedFile ? 2 : c.syncedLrc ? 1 : 0);
  return candidates
    .map((c) => scoreLyricsCandidate(wanted, c))
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        rank(b.candidate) - rank(a.candidate) ||
        Math.abs(a.durationDeltaMs ?? 0) - Math.abs(b.durationDeltaMs ?? 0),
    );
}

/* --------------------------- Selección de video --------------------------- */

export interface VideoCandidate {
  videoId: string;
  title: string;
  channel: string;
  durationMs?: number;
}

export interface ScoredVideo {
  video: VideoCandidate;
  score: number;
  reasons: string[];
}

const BAD_VIDEO_WORDS =
  /\b(reaction|react|tutorial|lesson|how to|review|karaoke|nightcore|8d|compilation|mix|playlist|full album|piano cover|guitar cover|drum cover|sped\s*up|slowed|reverb)\b/i;

/**
 * Puntúa un video de YouTube como fuente de reproducción de una pista.
 * Prioriza: canal "- Topic" (audio de estudio, sin introducciones), canales
 * oficiales del artista/VEVO y duración cercana a la de estudio.
 */
export function scoreVideoCandidate(wanted: WantedTrack, v: VideoCandidate): ScoredVideo {
  const reasons: string[] = [];
  const t = titleSimilarity(wanted.title, v.title.includes('-') ? v.title.split(/\s[-–—]\s/).pop()! : v.title);
  const titleContains = normalizeForCompare(v.title).includes(normalizeForCompare(wanted.title)) ? 1 : 0;
  const titleScore = Math.max(t, titleContains * 0.9);
  const channelClean = cleanChannelName(v.channel);
  const artistInChannel = artistSimilarity(wanted.artist, channelClean);
  const artistInTitle = normalizeForCompare(v.title).includes(normalizeForCompare(wanted.artist)) ? 1 : 0;
  const artistScore = Math.max(artistInChannel, artistInTitle * 0.9);

  let score = titleScore * 0.4 + artistScore * 0.25;

  if (/-\s*topic$/i.test(v.channel)) {
    score += 0.2;
    reasons.push('audio de estudio (canal Topic)');
  } else if (/vevo$/i.test(v.channel) || artistInChannel > 0.8) {
    score += 0.1;
    reasons.push('canal oficial');
  }

  if (v.durationMs && wanted.durationMs) {
    const d = v.durationMs - wanted.durationMs;
    score += durationScore(d) * 0.2;
    if (Math.abs(d) > 12000) reasons.push('duración distinta a la de estudio');
  }

  const wantedFlags = detectVersionFlags(`${wanted.title} ${wanted.album ?? ''}`);
  const videoFlags = detectVersionFlags(v.title);
  const diff = [...videoFlags].filter((f) => !wantedFlags.has(f));
  if (diff.length > 0) {
    score -= 0.35;
    reasons.push(`versión alternativa (${diff.join(', ')})`);
  }
  if (BAD_VIDEO_WORDS.test(v.title)) {
    score -= 0.35;
    reasons.push('no parece la canción original');
  }
  return { video: v, score, reasons };
}

export function pickBestVideo(wanted: WantedTrack, videos: VideoCandidate[]): ScoredVideo | null {
  if (videos.length === 0) return null;
  const scored = videos.map((v) => scoreVideoCandidate(wanted, v)).sort((a, b) => b.score - a.score);
  return scored[0].score >= 0.4 ? scored[0] : null;
}
