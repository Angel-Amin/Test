/**
 * Headless players used by the balance tests. Not shipped in the UI.
 */
import { DIRECTIVES } from './data';
import { atBase, estimateRisk, hops, injured, pathBetween, population } from './derived';
import {
  answerDecision, approveNeed, assignJob, canApprove, dispatch, endDay, newGame, totalAssigned, type OpPlan,
} from './engine';
import type { GameState, Res } from './types';
import { JOBS, RESOURCES } from './types';

export type Policy = (s: GameState) => void;

export const passive: Policy = (s) => {
  for (const d of [...s.decisions]) answerDecision(s, d.id, d.options.length - 1);
};

function staff(s: GameState): void {
  for (const j of JOBS) s.jobs[j] = 0;
  const want = (job: (typeof JOBS)[number], n: number) => {
    for (let i = 0; i < n; i++) assignJob(s, job, 1);
  };
  want('medic', Math.min(3, Math.ceil(injured(s) / 3)));
  if (s.projects.length) want('build', 5);
  const eat = atBase(s);
  const farmRate = 2 + s.facilities.garden;
  const waterRate = 4 + 2 * s.facilities.purifier;
  const foodDays = s.stock.food / Math.max(1, eat);
  const waterDays = s.stock.water / Math.max(1, eat);
  const free = s.civilians - totalAssigned(s);
  const waterNeed = Math.ceil(Math.max(0, eat - 5 * s.facilities.purifier) / waterRate) + (waterDays < 3 ? 2 : 0);
  want('water', Math.min(free, waterNeed));
  const free2 = s.civilians - totalAssigned(s);
  want('farm', Math.min(free2, Math.ceil(eat / farmRate) - (foodDays > 6 ? 4 : 0)));
  want('workshop', s.civilians - totalAssigned(s));
}

function neediest(s: GameState): Res {
  const days: Record<Res, number> = {
    food: s.stock.food / 30, water: s.stock.water / 30, fuel: s.stock.fuel / 6,
    ammo: s.stock.ammo / 25, meds: s.stock.meds / 3, parts: s.stock.parts / 10,
  };
  return RESOURCES.reduce((a, b) => (days[b] < days[a] ? b : a));
}

const SOURCE: Record<Res, string[]> = {
  food: ['market', 'farm'], water: ['farm', 'market', 'reservoir'], fuel: ['gas', 'rail'],
  ammo: ['sheriff', 'checkpoint'], meds: ['hospital', 'market'], parts: ['hardware', 'rail'],
};

export const competent: Policy = (s) => {
  for (const d of [...s.decisions]) {
    const idx = d.options.findIndex((o) => o.effect === 'refugees_fit' || o.effect === 'trade' || o.effect === 'militia' || o.effect === 'patrol_yes' || o.effect === 'fever_treat' || o.effect === 'refugees_all' || o.effect === 'theft_search');
    answerDecision(s, d.id, idx >= 0 ? idx : 0);
  }
  const prio = ['walls', 'watchtower', 'purifier', 'garden', 'infirmary', 'armory', 'bunkhouse', 'storage', 'motorpool', 'commons'];
  const needs = [...s.needs].sort((a, b) => prio.indexOf(a.facility) - prio.indexOf(b.facility));
  for (const n of needs) {
    const reserve = n.facility === 'walls' || n.facility === 'watchtower' ? 0 : 25;
    if (canApprove(s, n) && s.stock.parts - n.parts >= reserve) approveNeed(s, n.id);
  }

  const spareSoldiers = () => Math.max(0, s.soldiers - s.garrisonMin);
  const busy = (kind: string) => s.ops.filter((o) => o.kind === kind).length;

  // Early recon
  if (s.day <= 3 && busy('recon') === 0) {
    const t = ['market', 'hardware', 'gas', 'farm'].find((id) => !s.locations[id].intel);
    if (t) dispatch(s, { kind: 'recon', target: t, soldiers: 1, civilians: 1, trucks: 0, ammo: 10, siteDays: 0, priority: 'any' });
  }

  const d = s.directive ? DIRECTIVES[s.directive.index].title : '';
  if (d.startsWith('Take St') && busy('clear') === 0 && spareSoldiers() >= 4) {
    dispatch(s, { kind: 'clear', target: 'hospital', soldiers: Math.min(7, spareSoldiers()), civilians: 0, trucks: 0, ammo: 70, siteDays: 3, priority: 'any' });
  }
  if (d.startsWith('Bring me') && !s.hasRelay && !s.ops.some((o) => o.target === 'relay') && spareSoldiers() >= 4 && s.trucks > 0) {
    dispatch(s, { kind: 'scavenge', target: 'relay', soldiers: Math.min(7, spareSoldiers()), civilians: 2, trucks: 1, ammo: 70, siteDays: 1, priority: 'parts' });
  }

  for (let tries = 0; tries < 3; tries++) {
    if (s.trucks === 0 || busy('scavenge') >= 2) break;
    const r = neediest(s);
    const team = { soldiers: Math.min(3, spareSoldiers()), civilians: Math.min(4, s.civilians - 8), trucks: 1, ammo: Math.min(30, s.stock.ammo) };
    if (team.civilians <= 0) break;
    const ok = (id: string) =>
      s.locations[id].intel && hops(s, id) <= 2 && !s.ops.some((o) => o.target === id) &&
      ['Low', 'Moderate'].includes(estimateRisk(s, pathBetween(s, 'base', id), team));
    const target = SOURCE[r].find((id) => ok(id) && (s.locations[id].intel?.stock[r] ?? 0) > 20)
      ?? ['market', 'farm', 'hardware', 'gas'].find(ok);
    if (!target) {
      const unknown = ['farm', 'market', 'hardware', 'gas', 'reservoir', 'sheriff', 'rail'].find((id) => !s.locations[id].intel);
      if (unknown && busy('recon') === 0) dispatch(s, { kind: 'recon', target: unknown, soldiers: 1, civilians: 1, trucks: 0, ammo: 10, siteDays: 0, priority: 'any' });
      break;
    }
    const plan: OpPlan = { kind: 'scavenge', target, ...team, siteDays: 2, priority: r };
    if (typeof dispatch(s, plan) === 'string') break;
  }
  staff(s);
};

export interface SimResult {
  seed: number;
  won: boolean;
  title: string;
  day: number;
  population: number;
  trust: number;
  deaths: number;
  directives: number;
}

export function simulate(seed: number, policy: Policy, maxDays = 40): SimResult {
  const s = newGame(seed);
  for (let i = 0; i < maxDays && !s.over; i++) {
    policy(s);
    endDay(s);
  }
  return {
    seed,
    won: !!s.over?.won,
    title: s.over?.title ?? 'unfinished',
    day: s.day,
    population: population(s),
    trust: s.trust,
    deaths: s.deaths,
    directives: s.directivesDone,
  };
}
