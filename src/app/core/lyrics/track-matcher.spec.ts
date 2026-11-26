import { describe, expect, it } from 'vitest';
import { LyricsCandidate } from '../models/lyrics.models';
import { matchLevel, pickBestVideo, rankLyricsCandidates, scoreLyricsCandidate } from './track-matcher';
import {
  artistSimilarity,
  cleanChannelName,
  detectVersionFlags,
  parseYouTubeTitle,
  parseYouTubeUrl,
  stripNoise,
  titleSimilarity,
} from './text-normalize';

const cand = (over: Partial<LyricsCandidate>): LyricsCandidate => ({
  providerId: 'test',
  externalId: Math.random().toString(),
  trackName: 'Noches de Prueba',
  artistName: 'Artista Ficticio',
  albumName: 'Álbum Ficticio',
  durationMs: 180_000,
  instrumental: false,
  syncedLrc: '[00:01.00] x',
  ...over,
});

const wanted = {
  title: 'Noches de Prueba',
  artist: 'Artista Ficticio',
  album: 'Álbum Ficticio',
  durationMs: 180_000,
};

describe('normalización de títulos', () => {
  it('quita ruido de marketing pero no versiones', () => {
    expect(stripNoise('Noches de Prueba (Official Video) [4K]')).toBe('Noches de Prueba');
    expect(stripNoise('Noches de Prueba (Live at Arena)')).toContain('Live');
    expect(stripNoise('Noches (Remix)')).toContain('Remix');
  });

  it('detecta versiones alternativas', () => {
    expect([...detectVersionFlags('Song (Acoustic Version)')]).toContain('acoustic');
    expect([...detectVersionFlags('Song - Live at Wembley')]).toContain('live');
    expect([...detectVersionFlags('Song (sped up)')]).toContain('sped');
    expect(detectVersionFlags('Canción normal').size).toBe(0);
  });

  it('compara títulos ignorando acentos, mayúsculas y feat.', () => {
    expect(titleSimilarity('A Mí', 'a mi')).toBe(1);
    expect(titleSimilarity('Song (feat. Other)', 'Song')).toBe(1);
    expect(titleSimilarity('Blinding Lights', 'Blinding Lights (Official Audio)')).toBe(1);
    expect(titleSimilarity('Love', 'Love Story')).toBeLessThan(0.8);
  });

  it('reconoce colaboraciones en artistas', () => {
    expect(artistSimilarity('The Weeknd & ROSALÍA', 'The Weeknd')).toBeGreaterThan(0.9);
    expect(artistSimilarity('BTS', 'Coldplay')).toBeLessThan(0.4);
  });
});

describe('enlaces y títulos de YouTube', () => {
  const id = 'dQw4w9WgXcQ';
  it('extrae el id de formatos válidos', () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${id}&t=10s`)).toBe(id);
    expect(parseYouTubeUrl(`https://youtu.be/${id}?si=abc`)).toBe(id);
    expect(parseYouTubeUrl(`https://music.youtube.com/watch?v=${id}`)).toBe(id);
    expect(parseYouTubeUrl(`youtube.com/shorts/${id}`)).toBe(id);
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${id}`)).toBe(id);
  });

  it('rechaza hosts ajenos, ids inválidos y esquemas peligrosos', () => {
    expect(parseYouTubeUrl(`https://evil.com/watch?v=${id}`)).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=corto')).toBeNull();
    expect(parseYouTubeUrl(`javascript:alert(1)//youtube.com/watch?v=${id}`)).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=<script>')).toBeNull();
    expect(parseYouTubeUrl('')).toBeNull();
    expect(parseYouTubeUrl('no es un enlace')).toBeNull();
  });

  it('deduce artista y título', () => {
    expect(parseYouTubeTitle('Artista Ficticio - Noches de Prueba (Official Video)', 'X')).toEqual({
      artist: 'Artista Ficticio',
      title: 'Noches de Prueba',
    });
    expect(parseYouTubeTitle('Solo título', 'Artista Ficticio - Topic')).toEqual({
      artist: 'Artista Ficticio',
      title: 'Solo título',
    });
    expect(cleanChannelName('ArtistaVEVO')).toBe('Artista');
  });
});

describe('puntuación de letras', () => {
  it('coincidencia exacta → confianza alta', () => {
    const s = scoreLyricsCandidate(wanted, cand({}));
    expect(s.confidence).toBeGreaterThan(0.9);
    expect(matchLevel(s)).toBe('high');
  });

  it('una versión en vivo no se presenta como exacta', () => {
    const s = scoreLyricsCandidate(wanted, cand({ trackName: 'Noches de Prueba (Live)' }));
    expect(s.confidence).toBeLessThan(0.8);
    expect(s.reasons.join()).toContain('live');
  });

  it('duración muy distinta limita la confianza', () => {
    const s = scoreLyricsCandidate(wanted, cand({ durationMs: 215_000 }));
    expect(s.confidence).toBeLessThanOrEqual(0.5);
    expect(matchLevel(s)).not.toBe('high');
  });

  it('sin duración de referencia nunca es "alta"', () => {
    const s = scoreLyricsCandidate({ ...wanted, durationMs: undefined }, cand({}));
    expect(matchLevel(s)).toBe('probable');
  });

  it('otro artista con el mismo título queda baja', () => {
    const s = scoreLyricsCandidate(wanted, cand({ artistName: 'Otro Grupo Distinto' }));
    expect(matchLevel(s)).toBe('insufficient');
  });

  it('ordena eligiendo la duración más cercana y prefiere sincronía por palabra', () => {
    const ranked = rankLyricsCandidates(wanted, [
      cand({ externalId: 'a', durationMs: 189_000 }),
      cand({ externalId: 'b', durationMs: 180_500 }),
      cand({ externalId: 'c', durationMs: 180_200, wordSyncedFile: 'x' }),
    ]);
    expect(ranked[0].candidate.externalId).toBe('c');
    expect(ranked[1].candidate.externalId).toBe('b');
    expect(ranked[2].candidate.externalId).toBe('a');
  });
});

describe('selección de video', () => {
  const w = { title: 'Noches de Prueba', artist: 'Artista Ficticio', durationMs: 180_000 };
  it('prefiere audio de estudio del artista frente a covers y sped up', () => {
    const best = pickBestVideo(w, [
      { videoId: 'a', title: 'Noches de Prueba (sped up)', channel: 'Fan', durationMs: 150_000 },
      { videoId: 'b', title: 'Noches de Prueba - Piano Cover', channel: 'Pianista', durationMs: 181_000 },
      { videoId: 'c', title: 'Noches de Prueba', channel: 'Artista Ficticio - Topic', durationMs: 180_500 },
      { videoId: 'd', title: 'Artista Ficticio - Noches de Prueba (Official Video)', channel: 'ArtistaFicticioVEVO', durationMs: 195_000 },
    ]);
    expect(best?.video.videoId).toBe('c');
  });

  it('devuelve null cuando nada se parece', () => {
    expect(pickBestVideo(w, [{ videoId: 'z', title: 'Receta de pasta', channel: 'Cocina' }])).toBeNull();
  });
});
