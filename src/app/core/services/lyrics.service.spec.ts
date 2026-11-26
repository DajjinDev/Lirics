import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LyricsCandidate } from '../models/lyrics.models';
import { LYRICS_PROVIDERS } from '../providers/lyrics-provider';
import { LyricsService } from './lyrics.service';

const cand = (over: Partial<LyricsCandidate> = {}): LyricsCandidate => ({
  providerId: 'fake',
  externalId: 'a',
  trackName: 'Noches de Prueba',
  artistName: 'Artista Ficticio',
  albumName: 'Álbum Ficticio',
  durationMs: 180_000,
  instrumental: false,
  syncedLrc: '[00:05.00] uno\n[00:09.00] dos',
  ...over,
});
const wanted = { title: 'Noches de Prueba', artist: 'Artista Ficticio', album: 'Álbum Ficticio', durationMs: 180_000 };

const WORD_FILE = `
lines:
- text: hola mundo
  start_ms: 1000
  end_ms: 3000
  words:
  - text: 'hola '
    start_ms: 1000
  - text: mundo
    start_ms: 2000
`;

describe('LyricsService', () => {
  let svc: LyricsService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LYRICS_PROVIDERS,
          useValue: [
            { id: 'ok', label: 'ok', find: async () => [cand({ externalId: 'ok' })] },
            { id: 'boom', label: 'boom', find: async () => Promise.reject(new Error('caído')) },
          ],
        },
      ],
    });
    svc = TestBed.inject(LyricsService);
  });

  it('un proveedor caído no impide usar los demás', async () => {
    const all = await svc.fetchCandidates(wanted);
    expect(all.map((c) => c.externalId)).toEqual(['ok']);
  });

  it('coincidencia exacta con duración comprobada → FOUND_SYNCED', () => {
    const r = svc.evaluate('t', wanted, [cand()]);
    expect(r.status).toBe('FOUND_SYNCED');
    expect(r.lyrics?.synchronizationType).toBe('line');
    expect(r.message).toBeUndefined();
  });

  it('sin duración de referencia nunca se presenta como exacta → MATCH_UNCERTAIN', () => {
    const r = svc.evaluate('t', { ...wanted, durationMs: undefined }, [cand()]);
    expect(r.status).toBe('MATCH_UNCERTAIN');
    expect(r.lyrics).toBeDefined(); // se muestran, pero con aviso
    expect(r.message).toBeTruthy();
  });

  it('duración 15 s distinta → MATCH_UNCERTAIN o peor, nunca FOUND_SYNCED', () => {
    const r = svc.evaluate('t', wanted, [cand({ durationMs: 196_000 })]);
    expect(r.status).not.toBe('FOUND_SYNCED');
  });

  it('otro artista → NOT_FOUND con alternativas para elegir', () => {
    const r = svc.evaluate('t', wanted, [cand({ artistName: 'Banda Totalmente Distinta' })]);
    expect(r.status).toBe('NOT_FOUND');
    expect(r.alternatives).toHaveLength(1);
    expect(r.lyrics).toBeUndefined();
  });

  it('la elección manual del usuario se respeta aunque sea de baja confianza', () => {
    const r = svc.evaluate('t', wanted, [cand({ externalId: 'x', artistName: 'Banda Totalmente Distinta' })], 'x');
    expect(r.status).toBe('FOUND_SYNCED');
    expect(r.lyrics).toBeDefined();
  });

  it('instrumental', () => {
    const r = svc.evaluate('t', wanted, [cand({ instrumental: true, syncedLrc: undefined })]);
    expect(r.status).toBe('INSTRUMENTAL');
  });

  it('solo texto plano → FOUND_PLAIN sin inventar sincronía', () => {
    const r = svc.evaluate('t', wanted, [cand({ syncedLrc: undefined, plainLyrics: 'una\ndos' })]);
    expect(r.status).toBe('FOUND_PLAIN');
    expect(r.plainLyrics).toBe('una\ndos');
    expect(r.lyrics).toBeUndefined();
  });

  it('sin letras de ningún tipo → NOT_FOUND', () => {
    const r = svc.evaluate('t', wanted, [cand({ syncedLrc: undefined })]);
    expect(r.status).toBe('NOT_FOUND');
  });

  it('lista vacía → NOT_FOUND', () => {
    expect(svc.evaluate('t', wanted, []).status).toBe('NOT_FOUND');
  });

  it('usa la sincronía por palabra cuando existe y es válida', () => {
    const r = svc.evaluate('t', wanted, [cand({ wordSyncedFile: WORD_FILE })]);
    expect(r.lyrics?.synchronizationType).toBe('word');
  });

  it('si el archivo por palabra está corrupto, cae al LRC por líneas', () => {
    const r = svc.evaluate('t', wanted, [cand({ wordSyncedFile: ': : [' })]);
    expect(r.lyrics?.synchronizationType).toBe('line');
  });
});
