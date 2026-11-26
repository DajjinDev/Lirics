/**
 * PRUEBA EN VIVO de los proveedores reales (red). NO corre en `npm test`: se activa con
 *   LIRIKS_LIVE=1 npx ng test --watch=false
 * Opcional: LIRIKS_YT_KEY=<tu clave> para probar también YouTube Data API v3.
 * Escribe un informe en LIRIKS_LIVE_REPORT (ruta del archivo) con lo que se ejecutó DE VERDAD.
 *
 * Límites a respetar: iTunes ≈ 20 peticiones/min y MusicBrainz 1/s → se espacian las consultas.
 */
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { matchLevel, matchScore } from '../core/lyrics/track-matcher';
import { ItunesProvider } from '../core/providers/itunes.provider';
import { LrclibProvider } from '../core/providers/lrclib.provider';
import { MusicBrainzProvider } from '../core/providers/musicbrainz.provider';
import { CoverArtProvider } from '../core/providers/cover-art.provider';
import { YouTubeProvider } from '../core/providers/youtube.provider';
import { LyricsService } from '../core/services/lyrics.service';
import { SettingsService } from '../core/services/settings.service';

const env = (k: string): string | undefined => (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env[k];
const LIVE = env('LIRIKS_LIVE') === '1';
const REPORT = env('LIRIKS_LIVE_REPORT');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canciones candidatas de la especificación (§60). No se asume que tengan letra sincronizada. */
const SONGS: { label: string; title: string; artist: string }[] = [
  { label: 'español (rap)', title: 'A Mí', artist: 'Rels B' },
  { label: 'coreano', title: 'Her', artist: 'BTS' },
  { label: 'inglés, intro larga', title: 'Blinding Lights', artist: 'The Weeknd' },
  { label: 'español, colaboración', title: 'Despacito', artist: 'Luis Fonsi' },
  { label: 'inglés', title: 'Shape of You', artist: 'Ed Sheeran' },
  { label: 'rap rápido', title: 'Lose Yourself', artist: 'Eminem' },
  { label: 'varios artistas', title: 'Calm Down', artist: 'Rema' },
  { label: 'versión acústica', title: 'Let Her Go (Acoustic)', artist: 'Passenger' },
  { label: 'instrumental', title: 'Clair de Lune', artist: 'Claude Debussy' },
  { label: 'coreano 2', title: 'Spring Day', artist: 'BTS' },
];

interface Row {
  label: string;
  query: string;
  itunes: string;
  durationS: number | null;
  lyrics: string;
  mb: string;
  caa: string;
}

describe.skipIf(!LIVE)('Proveedores REALES (en vivo)', () => {
  it(
    'recorre el flujo catálogo → letras → puntuación → MusicBrainz → Cover Art Archive',
    async () => {
      localStorage.clear();
      // MusicBrainz limita (403) a los clientes que no se identifican. Un NAVEGADOR envía su propio
      // User-Agent, pero este test corre en Node: solo aquí se añade uno identificable.
      const realFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('musicbrainz.org')) return realFetch(input, init);
        const headers = new Headers(init?.headers);
        headers.set('User-Agent', 'Liriks/0.1 (local-development)');
        return realFetch(input, { ...init, headers });
      }) as typeof fetch;
      TestBed.configureTestingModule({});
      const itunes = TestBed.inject(ItunesProvider);
      const lyrics = TestBed.inject(LyricsService);
      const lrclib = TestBed.inject(LrclibProvider);
      const mb = TestBed.inject(MusicBrainzProvider);
      const caa = TestBed.inject(CoverArtProvider);
      const rows: Row[] = [];
      const notes: string[] = [];

      for (const s of SONGS) {
        const row: Row = { label: s.label, query: `${s.title} — ${s.artist}`, itunes: '—', durationS: null, lyrics: '—', mb: '—', caa: '—' };
        try {
          const found = await itunes.search(`${s.artist} ${s.title}`, undefined, 5);
          const best = found[0];
          row.itunes = best ? `${best.title} · ${best.artist} · ${best.album ?? 'sin álbum'}${best.artworkUrl ? ' · portada' : ' · SIN portada'}` : 'NO ENCONTRADA';
          row.durationS = best?.durationMs ? Math.round(best.durationMs / 1000) : null;

          const wanted = { title: best?.title ?? s.title, artist: best?.artist ?? s.artist, album: best?.album, durationMs: best?.durationMs };
          const cands = await lyrics.fetchCandidates(wanted);
          const res = lyrics.evaluate('live', wanted, cands);
          const sync = res.lyrics?.synchronizationType ?? '-';
          row.lyrics = `${res.status}${res.best ? ` · ${matchScore(res.best)}/100 (${matchLevel(res.best)})` : ''} · sync=${sync} · ${cands.length} candidatos${res.lyrics?.lines.some((l) => l.isBreak) ? ' · con pausas' : ''}`;
        } catch (e) {
          row.lyrics = `ERROR: ${(e as Error).message}`;
        }

        try {
          const rel = await mb.findRelease(s.title.replace(/ \(.*\)$/, ''), s.artist);
          row.mb = rel ? `${rel.title} (${rel.date ?? '?'})` : 'sin coincidencia';
          if (rel) {
            const url = caa.frontUrl('release-group', rel.releaseGroupId ?? rel.releaseId, 500);
            if (url) {
              const r = await fetch(url, { method: 'GET', redirect: 'follow' });
              row.caa = `${r.status} ${r.headers.get('content-type') ?? ''} · CORS=${r.headers.get('access-control-allow-origin') ?? 'no'}`;
            }
          }
        } catch (e) {
          row.mb = `ERROR: ${(e as Error).message}`;
        }
        rows.push(row);
        await sleep(3500); // respeta el límite de iTunes (~20/min) y MusicBrainz (1/s)
      }

      // LRCLIB: GET /api/get/{id} con un id real obtenido arriba
      const sample = await lrclib.find({ title: 'Blinding Lights', artist: 'The Weeknd', durationMs: 200_000 });
      const byId = sample[0] ? await lrclib.getById(sample[0].externalId) : null;
      notes.push(`LRCLIB getById(${sample[0]?.externalId}) → ${byId ? 'OK ' + byId.trackName : 'null'}`);

      // YouTube Data API: solo con clave
      const key = env('LIRIKS_YT_KEY');
      if (key) {
        const settings = TestBed.inject(SettingsService);
        settings.update('youtubeApiKey', key);
        const yt = TestBed.inject(YouTubeProvider);
        try {
          const vids = await yt.searchVideos('Rels B A Mí');
          notes.push(`YouTube search → ${vids.length} videos; primero: ${vids[0]?.title} · ${vids[0]?.durationMs}ms`);
          const info = await yt.getVideoInfo('4NRXx6U8ABQ');
          notes.push(`YouTube videos.list → ${info.trackTitle} · duración=${info.durationMs}ms · insertable=${info.embeddable}`);
        } catch (e) {
          notes.push(`YouTube Data API ERROR: ${(e as Error).message}`);
        }
      } else {
        notes.push('YouTube Data API: OMITIDO (no se proporcionó LIRIKS_YT_KEY)');
      }

      const report = JSON.stringify({ when: new Date().toISOString(), rows, notes }, null, 2);
      if (REPORT) {
        // Import dinámico: el proyecto no incluye los tipos de Node (solo esta prueba opcional usa fs).
        const fsModule = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { writeFileSync(p: string, d: string, e: string): void };
        fsModule.writeFileSync(REPORT, report, 'utf8');
      }
      expect(rows).toHaveLength(SONGS.length);
    },
    240_000,
  );
});
