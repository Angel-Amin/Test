import type { GameState, Operation, Res, Stock } from './types';
import { RESOURCES } from './types';

export const BASE_ID = 'base';
export const TRUCK_CAPACITY = 60;
export const CIVILIAN_CARRY = 6;
export const SOLDIER_CARRY = 2;
export const GENERATOR_FUEL = 3;

const BASE_CAPS: Stock = { food: 260, water: 200, fuel: 160, ammo: 400, meds: 60, parts: 200 };

export function emptyStock(): Stock {
  return { food: 0, water: 0, fuel: 0, ammo: 0, meds: 0, parts: 0 };
}

export function stockTotal(st: Stock): number {
  return RESOURCES.reduce((sum, r) => sum + st[r], 0);
}

export function cap(s: GameState, r: Res): number {
  return Math.round(BASE_CAPS[r] * (1 + 0.5 * s.facilities.storage));
}

export function fieldPeople(s: GameState): { soldiers: number; civilians: number } {
  let soldiers = 0;
  let civilians = 0;
  for (const op of s.ops) {
    soldiers += op.soldiers + op.woundedSoldiers;
    civilians += op.civilians + op.woundedCivilians;
  }
  return { soldiers, civilians };
}

export function population(s: GameState): number {
  const f = fieldPeople(s);
  return s.civilians + s.soldiers + s.injuredCivilians + s.injuredSoldiers + f.soldiers + f.civilians;
}

/** Mouths to feed at base today (field teams carry rations). */
export function atBase(s: GameState): number {
  return s.civilians + s.soldiers + s.injuredCivilians + s.injuredSoldiers;
}

export function housing(s: GameState): number {
  return 32 + 12 * s.facilities.bunkhouse;
}

export function injured(s: GameState): number {
  return s.injuredCivilians + s.injuredSoldiers;
}

export function idleCivilians(s: GameState): number {
  const assigned = Object.values(s.jobs).reduce((a, b) => a + b, 0);
  return Math.max(0, s.civilians - assigned);
}

export function spotRange(s: GameState): number {
  return 1 + s.facilities.watchtower;
}

export function fuelPerTruckHop(s: GameState): number {
  return s.facilities.motorpool > 0 ? 2 : 3;
}

export function baseDefense(s: GameState): number {
  const ammoOk = s.stock.ammo >= s.soldiers * 4;
  const soldierPower = s.soldiers * (ammoOk ? 4 : 1.5);
  const civPower = s.civilians * (s.stock.ammo > 40 ? 0.6 : 0.2);
  return Math.round(soldierPower + civPower + 20 * s.facilities.walls);
}

export function opFirepower(op: Pick<Operation, 'soldiers' | 'civilians' | 'ammo' | 'trucks'>): number {
  const armed = op.ammo >= op.soldiers * 3;
  return op.soldiers * (armed ? 4 : 1.5) + op.civilians * 0.5 + (op.trucks > 0 ? 1 : 0);
}

export function haulCapacity(op: Pick<Operation, 'soldiers' | 'civilians' | 'trucks'>): number {
  return op.trucks * TRUCK_CAPACITY + op.civilians * CIVILIAN_CARRY + op.soldiers * SOLDIER_CARRY;
}

/** Shortest path from `from` to `to` (excluding `from`), by hops. */
export function pathBetween(s: GameState, from: string, to: string): string[] {
  if (from === to) return [];
  const prev: Record<string, string | null> = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of s.locations[cur].links) {
      if (!(n in prev)) {
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  const path: string[] = [];
  let cur: string | null = to;
  while (cur && cur !== from) {
    path.unshift(cur);
    cur = prev[cur] ?? null;
  }
  return path;
}

export function hops(s: GameState, id: string): number {
  return pathBetween(s, BASE_ID, id).length;
}

export function daysPerHop(trucks: number): number {
  return trucks > 0 ? 1 : 2;
}

export function knownThreat(s: GameState, id: string): number | null {
  const loc = s.locations[id];
  if (id === BASE_ID) return 0;
  return loc.intel ? loc.intel.threat : null;
}

export type RiskLabel = 'Low' | 'Moderate' | 'High' | 'Extreme' | 'Unknown';

/** Planning estimate from intel only: how hard is the hardest node on the route vs. this team? */
export function estimateRisk(
  s: GameState,
  path: string[],
  team: Pick<Operation, 'soldiers' | 'civilians' | 'ammo' | 'trucks'>,
): RiskLabel {
  let worst = 0;
  for (const id of path) {
    const t = knownThreat(s, id);
    if (t === null) return 'Unknown';
    worst = Math.max(worst, t);
  }
  const fp = opFirepower(team);
  const expected = worst * 3.5;
  if (expected <= 0.1) return 'Low';
  const ratio = fp / expected;
  if (ratio >= 1.6) return 'Low';
  if (ratio >= 1.0) return 'Moderate';
  if (ratio >= 0.55) return 'High';
  return 'Extreme';
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
