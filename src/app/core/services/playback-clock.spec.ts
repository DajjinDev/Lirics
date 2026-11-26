import { describe, expect, it } from 'vitest';
import { PlaybackClock } from './playback-clock';

function setup() {
  let t = 1000;
  const clock = new PlaybackClock(() => t);
  return { clock, advance: (ms: number) => (t += ms) };
}

describe('PlaybackClock', () => {
  it('no avanza en pausa', () => {
    const { clock, advance } = setup();
    clock.sample(5000);
    advance(3000);
    expect(clock.now()).toBe(5000);
  });

  it('avanza en reproducción y se congela al pausar, sin perder posición', () => {
    const { clock, advance } = setup();
    clock.sample(5000);
    clock.setPlaying(true);
    advance(1000);
    expect(clock.now()).toBeCloseTo(6000, 0);
    clock.setPlaying(false);
    advance(5000);
    expect(clock.now()).toBeCloseTo(6000, 0);
    clock.setPlaying(true);
    advance(500);
    expect(clock.now()).toBeCloseTo(6500, 0);
  });

  it('salta directamente ante un seek grande', () => {
    const { clock, advance } = setup();
    clock.sample(5000);
    clock.setPlaying(true);
    advance(100);
    clock.sample(90_000);
    expect(clock.now()).toBe(90_000);
    clock.sample(10_000);
    expect(clock.now()).toBe(10_000);
  });

  it('corrige gradualmente un error pequeño sin retroceder de golpe', () => {
    const { clock, advance } = setup();
    clock.sample(0);
    clock.setPlaying(true);
    advance(1000);
    const before = clock.now(); // 1000
    clock.sample(950); // el reproductor va 50 ms por detrás
    expect(clock.now()).toBeGreaterThan(950);
    expect(clock.now()).toBeLessThan(before);
  });

  it('no acumula deriva en una larga reproducción con lecturas periódicas', () => {
    const { clock, advance } = setup();
    clock.sample(0);
    clock.setPlaying(true);
    let real = 0;
    for (let i = 0; i < 2400; i++) {
      advance(250);
      real += 250;
      clock.sample(real + (i % 2 === 0 ? 40 : -40)); // ruido del reproductor
    }
    expect(Math.abs(clock.now() - real)).toBeLessThan(60);
  });

  it('respeta la velocidad de reproducción', () => {
    const { clock, advance } = setup();
    clock.sample(0);
    clock.setPlaying(true);
    clock.setRate(2);
    advance(1000);
    expect(clock.now()).toBeCloseTo(2000, 0);
  });

  it('seek explícito reposiciona', () => {
    const { clock } = setup();
    clock.seek(42_000);
    expect(clock.now()).toBe(42_000);
  });
});
