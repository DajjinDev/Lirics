import { Injectable, signal } from '@angular/core';
import { Track } from '../models/music.models';

const RECENT_KEY = 'liriks.recent.v1';
const QUERIES_KEY = 'liriks.queries.v1';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: no es crítico */
  }
}

/** Canciones recientes y búsquedas anteriores. Solo local, sin servidor. */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  readonly recent = signal<Track[]>(this.loadRecent());
  readonly queries = signal<string[]>(read<string>(QUERIES_KEY).filter((q) => typeof q === 'string').slice(0, 8));

  addTrack(track: Track): void {
    const next = [track, ...this.recent().filter((t) => t.id !== track.id)].slice(0, 10);
    this.recent.set(next);
    write(RECENT_KEY, next);
  }

  addQuery(query: string): void {
    const q = query.trim();
    if (q.length < 2) return;
    const next = [q, ...this.queries().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    this.queries.set(next);
    write(QUERIES_KEY, next);
  }

  removeQuery(query: string): void {
    const next = this.queries().filter((q) => q !== query);
    this.queries.set(next);
    write(QUERIES_KEY, next);
  }

  clear(): void {
    this.recent.set([]);
    this.queries.set([]);
    write(RECENT_KEY, []);
    write(QUERIES_KEY, []);
  }

  private loadRecent(): Track[] {
    // Se validan los campos: lo leído del almacenamiento no es de confianza.
    return read<Track>(RECENT_KEY)
      .filter((t) => t && typeof t.id === 'string' && /^(itunes:\d+|yt:[\w-]{11})$/.test(t.id) && typeof t.title === 'string' && typeof t.artist === 'string')
      .slice(0, 10);
  }
}
