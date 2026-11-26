import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitize, SettingsService, VIEW_MODES } from './settings.service';

describe('sanitize', () => {
  it('valores válidos se conservan', () => {
    const s = sanitize({ viewMode: 'cinematic', fontFamily: 'sora', coverScale: 1.2, lyricScale: 1.1 });
    expect(s.viewMode).toBe('cinematic');
    expect(s.fontFamily).toBe('sora');
    expect(s.coverScale).toBe(1.2);
    expect(s.lyricScale).toBe(1.1);
  });

  it('valores fuera de rango se acotan y los inválidos vuelven al predeterminado', () => {
    const s = sanitize({
      viewMode: 'hacked' as never,
      fontFamily: '<script>' as never,
      coverScale: 99,
      lyricScale: -5,
      secondaryOpacity: Number.NaN,
      wordSync: 'x' as never,
    });
    expect(s.viewMode).toBe(DEFAULT_SETTINGS.viewMode);
    expect(s.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(s.coverScale).toBe(1.3);
    expect(s.lyricScale).toBe(0.8);
    expect(s.secondaryOpacity).toBe(DEFAULT_SETTINGS.secondaryOpacity);
    expect(s.wordSync).toBe('auto');
  });

  it('una configuración antigua (sin campos nuevos) se completa con los predeterminados', () => {
    const s = sanitize({ lyricScale: 1.2 });
    expect(s.viewMode).toBe('classic');
    expect(s.coverScale).toBe(1);
  });
});

describe('SettingsService', () => {
  let svc: SettingsService;
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(SettingsService);
  });

  it('cycleViewMode recorre todos los modos y vuelve al inicio', () => {
    const seen: string[] = [svc.settings().viewMode];
    for (let i = 0; i < VIEW_MODES.length; i++) {
      svc.cycleViewMode();
      seen.push(svc.settings().viewMode);
    }
    expect(seen[0]).toBe('classic');
    expect(new Set(seen.slice(0, VIEW_MODES.length)).size).toBe(VIEW_MODES.length);
    expect(seen[VIEW_MODES.length]).toBe('classic');
  });

  it('cycleViewMode devuelve la etiqueta del nuevo modo', () => {
    expect(svc.cycleViewMode()).toBe(VIEW_MODES[1].label);
  });

  it('update valida: un modo inventado no se aplica', () => {
    svc.update('viewMode', 'nope' as never);
    expect(svc.settings().viewMode).toBe('classic');
  });

  it('reset restablece lo visual pero conserva la clave de API', () => {
    svc.update('youtubeApiKey', 'clave-ficticia');
    svc.update('viewMode', 'cover');
    svc.reset();
    expect(svc.settings().viewMode).toBe('classic');
    expect(svc.settings().youtubeApiKey).toBe('clave-ficticia');
  });

  it('el ajuste de sincronía por versión se guarda y 0 lo elimina', () => {
    svc.saveOffset('t|v', 300);
    expect(svc.getOffset('t|v')).toBe(300);
    svc.saveOffset('t|v', 0);
    expect(svc.getOffset('t|v')).toBe(0);
    expect(localStorage.getItem('liriks.offset.t|v')).toBeNull();
  });
});
