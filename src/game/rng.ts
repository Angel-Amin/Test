import type { GameState } from './types';

/** Deterministic mulberry32 step; the state lives in GameState so saves replay identically. */
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(s: GameState, min: number, max: number): number {
  return min + rand(s) * (max - min);
}

export function int(s: GameState, min: number, max: number): number {
  return Math.floor(range(s, min, max + 1));
}

export function chance(s: GameState, p: number): boolean {
  return rand(s) < p;
}

export function pick<T>(s: GameState, items: readonly T[]): T {
  return items[Math.floor(rand(s) * items.length)];
}
