import { DIRECTIVES, FACILITIES, FACILITY_ORDER, FINAL_DAY, HORDE_SOURCES, makeLocations } from './data';
import {
  BASE_ID, GENERATOR_FUEL, atBase, baseDefense, cap, clamp, daysPerHop, emptyStock, fuelPerTruckHop,
  haulCapacity, hops, housing, injured, opFirepower, pathBetween, population, spotRange, stockTotal,
} from './derived';
import { chance, int, pick, rand, range } from './rng';
import type {
  Decision, DayReport, GameState, Horde, Job, LogTone, NeedRequest, OpKind, Operation, Res, Stock,
} from './types';
import { JOBS, RESOURCES } from './types';

export const SAVE_VERSION = 1;

/* ------------------------------------------------------------------ setup */

export function newGame(seed = Date.now() % 2147483647): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    day: 1,
    baseName: 'Kestrel Quarry',
    stock: { food: 170, water: 120, fuel: 80, ammo: 160, meds: 14, parts: 90 },
    civilians: 22,
    soldiers: 8,
    injuredCivilians: 0,
    injuredSoldiers: 0,
    trucks: 2,
    brokenTrucks: 0,
    jobs: { farm: 8, water: 6, workshop: 2, build: 0, medic: 1 },
    morale: 60,
    trust: 55,
    facilities: {
      infirmary: 0, garden: 0, purifier: 0, walls: 0, watchtower: 0,
      storage: 0, bunkhouse: 0, armory: 0, motorpool: 0, commons: 0,
    },
    projects: [],
    needs: [],
    needHistory: {},
    decisions: [],
    ops: [],
    hordes: [],
    locations: makeLocations(),
    directive: null,
    directivesDone: 0,
    directivesFailed: 0,
    garrisonMin: 4,
    hasRelay: false,
    sieges: 0,
    breaches: 0,
    deaths: 0,
    nextId: 1,
    nextHordeDay: 6,
    wasted: 0,
    flags: { relayAtSite: 1, nextDirective: 0 },
    log: [],
    over: null,
  };
  report = { day: 1, lines: [] };
  issueDirectives(s);
  log(s, 'info', `Day 1. The Commander has made you second in command of ${s.baseName}. Logistics are yours.`);
  return s;
}

/* -------------------------------------------------------------- reporting */

let report: DayReport = { day: 1, lines: [] };

function log(s: GameState, tone: LogTone, text: string): void {
  const line = { day: s.day, tone, text };
  s.log.push(line);
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  report.lines.push(line);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/* ---------------------------------------------------------------- staffing */

export function totalAssigned(s: GameState): number {
  return JOBS.reduce((a, j) => a + s.jobs[j], 0);
}

export function assignJob(s: GameState, job: Job, delta: number): void {
  if (delta > 0 && totalAssigned(s) >= s.civilians) return;
  s.jobs[job] = Math.max(0, s.jobs[job] + delta);
  s.flags[`cut_${job}`] = 0; // a manual change overrides the auto-restore
}

/** Pull workers off jobs when civilians leave base (latest-priority jobs first). */
function normalizeJobs(s: GameState): void {
  let over = totalAssigned(s) - s.civilians;
  const order: Job[] = ['build', 'workshop', 'water', 'farm', 'medic'];
  for (const j of order) {
    if (over <= 0) break;
    const take = Math.min(over, s.jobs[j]);
    s.jobs[j] -= take;
    s.flags[`cut_${j}`] = (s.flags[`cut_${j}`] ?? 0) + take;
    over -= take;
  }
}

/** Put idle civilians back on the jobs they were pulled from. */
function restoreJobs(s: GameState): void {
  for (const j of ['medic', 'farm', 'water', 'workshop', 'build'] as Job[]) {
    const want = s.flags[`cut_${j}`] ?? 0;
    const give = Math.min(want, s.civilians - totalAssigned(s));
    if (give <= 0) continue;
    s.jobs[j] += give;
    s.flags[`cut_${j}`] = want - give;
  }
}

/* -------------------------------------------------------------- operations */

export interface OpPlan {
  kind: OpKind;
  target: string;
  soldiers: number;
  civilians: number;
  trucks: number;
  ammo: number;
  siteDays: number;
  priority: Res | 'any';
}

export function planDays(s: GameState, plan: OpPlan): { out: number; site: number; total: number } {
  const out = hops(s, plan.target) * daysPerHop(plan.trucks);
  const site = plan.kind === 'recon' ? 0 : plan.siteDays;
  return { out, site, total: out * 2 + site };
}

export function planFuel(s: GameState, plan: OpPlan): number {
  return plan.trucks * fuelPerTruckHop(s) * hops(s, plan.target) * 2;
}

export function planRations(s: GameState, plan: OpPlan): number {
  return (plan.soldiers + plan.civilians) * planDays(s, plan).total;
}

export function validatePlan(s: GameState, plan: OpPlan): string | null {
  if (plan.target === BASE_ID) return 'Pick a destination.';
  const people = plan.soldiers + plan.civilians;
  if (people <= 0) return 'Assign at least one person.';
  if (plan.soldiers > s.soldiers) return 'Not enough soldiers at base.';
  if (plan.civilians > s.civilians) return 'Not enough civilians at base.';
  if (plan.trucks > s.trucks) return 'Not enough working trucks.';
  if (plan.ammo > s.stock.ammo) return 'Not enough ammo in stores.';
  if ((plan.kind === 'clear' || plan.kind === 'intercept') && plan.soldiers < 1) return 'Combat operations need soldiers.';
  if (plan.kind === 'recon' && people > 3) return 'Recon teams are 3 people at most.';
  const fuel = planFuel(s, plan);
  if (fuel > s.stock.fuel) return `Needs ${fuel} fuel.`;
  const rations = planRations(s, plan);
  if (rations > s.stock.food) return `Needs ${rations} food for rations.`;
  if (rations > s.stock.water) return `Needs ${rations} water for rations.`;
  return null;
}

export function dispatch(s: GameState, plan: OpPlan): Operation | string {
  const err = validatePlan(s, plan);
  if (err) return err;
  const days = planDays(s, plan);
  const rations = planRations(s, plan);
  s.soldiers -= plan.soldiers;
  s.civilians -= plan.civilians;
  s.trucks -= plan.trucks;
  s.stock.ammo -= plan.ammo;
  s.stock.fuel -= planFuel(s, plan);
  s.stock.food -= rations;
  s.stock.water -= rations;
  normalizeJobs(s);
  const op: Operation = {
    id: s.nextId++,
    kind: plan.kind,
    target: plan.target,
    path: pathBetween(s, BASE_ID, plan.target),
    soldiers: plan.soldiers,
    civilians: plan.civilians,
    trucks: plan.trucks,
    ammo: plan.ammo,
    priority: plan.priority,
    siteDays: days.site,
    leg: 'out',
    legDay: 0,
    legLength: days.out,
    cargo: emptyStock(),
    woundedSoldiers: 0,
    woundedCivilians: 0,
    startDay: s.day,
    carriesRelay: false,
  };
  s.ops.push(op);
  s.log.push({ day: s.day, tone: 'info', text: `${opLabel(s, op)} dispatched (${plan.soldiers} soldiers, ${plan.civilians} civilians, ${plan.trucks} trucks).` });
  return op;
}

export function opLabel(s: GameState, op: Operation): string {
  const names: Record<OpKind, string> = { scavenge: 'Supply run', recon: 'Recon', clear: 'Clearing op', intercept: 'Intercept' };
  return `${names[op.kind]} #${op.id} → ${s.locations[op.target].name}`;
}

export function recall(s: GameState, opId: number): void {
  const op = s.ops.find((o) => o.id === opId);
  if (!op || op.leg === 'back') return;
  const dph = daysPerHop(op.trucks);
  const traveled = op.leg === 'out' ? op.legDay : op.path.length * dph;
  op.leg = 'back';
  op.legLength = Math.max(1, traveled);
  op.legDay = 0;
  s.log.push({ day: s.day, tone: 'info', text: `${opLabel(s, op)} recalled.` });
}

/** The node an operation currently occupies. */
export function opNode(op: Operation): string {
  const dph = daysPerHop(op.trucks);
  if (op.leg === 'site') return op.target;
  if (op.leg === 'out') {
    const idx = Math.min(op.path.length - 1, Math.floor(op.legDay / dph));
    return op.path[Math.max(0, idx)];
  }
  const remaining = op.legLength - op.legDay;
  const idx = Math.ceil(remaining / dph) - 1;
  return idx < 0 ? BASE_ID : op.path[Math.min(op.path.length - 1, idx)];
}

function updateIntel(s: GameState, id: string): void {
  const loc = s.locations[id];
  loc.intel = { day: s.day, threat: r1(loc.threat), stock: { ...loc.stock } };
}

function activeMembers(op: Operation): number {
  return op.soldiers + op.civilians;
}

/** Combat between a field team and a force of `strength`. Returns true if the team held. */
function fight(s: GameState, op: Operation, strength: number, where: string): boolean {
  const fp = opFirepower(op);
  const used = Math.min(op.ammo, op.soldiers * int(s, 2, 5));
  op.ammo -= used;
  if (fp >= strength) {
    if (strength > fp * 0.6 && chance(s, 0.5)) {
      woundOne(op);
      log(s, 'warn', `${opLabel(s, op)}: fought off the dead at ${where}. One wounded.`);
    } else {
      log(s, 'info', `${opLabel(s, op)}: brushed off a group of dead at ${where}.`);
    }
    return true;
  }
  const deficit = strength - fp;
  const casualties = Math.ceil(deficit / 4);
  let killed = 0;
  let wounded = 0;
  for (let i = 0; i < casualties && activeMembers(op) > 0; i++) {
    const soldier = op.soldiers > 0 && (op.civilians === 0 || chance(s, 0.6));
    if (soldier) op.soldiers--; else op.civilians--;
    if (chance(s, 0.5)) {
      killed++;
    } else {
      wounded++;
      if (soldier) op.woundedSoldiers++; else op.woundedCivilians++;
    }
  }
  s.deaths += killed;
  if (op.trucks > 0 && deficit > 10 && chance(s, 0.3)) {
    op.trucks--;
    log(s, 'bad', `${opLabel(s, op)}: a truck was lost at ${where}.`);
  }
  trimCargo(op);
  const parts = [killed && `${killed} killed`, wounded && `${wounded} wounded`].filter(Boolean).join(', ');
  log(s, 'bad', `${opLabel(s, op)}: overwhelmed at ${where}. ${parts || 'No casualties, but they had to run'}.`);
  if (killed) moraleHit(s, killed * 3);
  return false;
}

function woundOne(op: Operation): void {
  if (op.soldiers > 0) {
    op.soldiers--;
    op.woundedSoldiers++;
  } else if (op.civilians > 0) {
    op.civilians--;
    op.woundedCivilians++;
  }
}

function trimCargo(op: Operation): void {
  let excess = stockTotal(op.cargo) - haulCapacity(op);
  for (const r of RESOURCES) {
    if (excess <= 0) break;
    const drop = Math.min(excess, op.cargo[r]);
    op.cargo[r] -= drop;
    excess -= drop;
  }
}

function encounter(s: GameState, op: Operation, node: string, mult: number): void {
  const threat = s.locations[node].threat;
  if (threat <= 0.05) return;
  if (!chance(s, clamp(0.05 * threat * mult, 0, 0.85))) return;
  fight(s, op, threat * range(s, 2, 5), s.locations[node].name);
}

function scavengeDay(s: GameState, op: Operation): void {
  const loc = s.locations[op.target];
  let room = haulCapacity(op) - stockTotal(op.cargo);
  let effort = op.civilians * 15 + op.soldiers * 5;
  const take = (r: Res, max: number) => {
    const n = Math.floor(Math.min(max, loc.stock[r], room, effort));
    loc.stock[r] -= n;
    op.cargo[r] += n;
    room -= n;
    effort -= n;
  };
  if (op.priority !== 'any') take(op.priority, Infinity);
  // Then the most plentiful remaining resources first.
  const rest = [...RESOURCES].sort((a, b) => loc.stock[b] - loc.stock[a]);
  for (const r of rest) if (room > 0 && effort > 0) take(r, Infinity);
  loc.threat = clamp(loc.threat + 0.15, 0, 10);
  if (op.target === 'relay' && s.flags.relayAtSite) {
    s.flags.relayAtSite = 0;
    op.carriesRelay = true;
    log(s, 'good', `${opLabel(s, op)}: the relay unit is unbolted and loaded.`);
  }
}

function clearDay(s: GameState, op: Operation): void {
  const loc = s.locations[op.target];
  if (loc.threat <= 0.05) return;
  const won = fight(s, op, loc.threat * range(s, 2.5, 5), loc.name);
  const armed = op.ammo >= op.soldiers * 2;
  const cut = won ? op.soldiers * 0.3 * (armed ? 1 : 0.4) : 0.3;
  loc.threat = clamp(loc.threat - cut, 0, 10);
  if (won) log(s, 'good', `${opLabel(s, op)}: threat at ${loc.name} reduced to ${r1(loc.threat)}.`);
  if (op.target === 'relay' && s.flags.relayAtSite && loc.threat < 3) {
    s.flags.relayAtSite = 0;
    op.carriesRelay = true;
    log(s, 'good', `${opLabel(s, op)}: grabbed the relay unit while the site was quiet.`);
  }
}

function arrive(s: GameState, op: Operation): void {
  updateIntel(s, op.target);
  if (op.kind === 'recon') {
    for (const n of s.locations[op.target].links) if (n !== BASE_ID) updateIntel(s, n);
    for (const h of s.hordes) {
      if (h.at === op.target || s.locations[op.target].links.includes(h.at)) spot(s, h, 'by the recon team');
    }
    log(s, 'good', `${opLabel(s, op)}: intel gathered on ${s.locations[op.target].name} and its approaches.`);
    startBack(op);
    return;
  }
  log(s, 'info', `${opLabel(s, op)}: arrived on site.`);
  op.leg = 'site';
  op.legDay = 0;
  op.legLength = op.siteDays;
}

function startBack(op: Operation): void {
  op.leg = 'back';
  op.legDay = 0;
  op.legLength = op.path.length * daysPerHop(op.trucks);
}

function returnHome(s: GameState, op: Operation): void {
  s.soldiers += op.soldiers;
  s.civilians += op.civilians;
  s.injuredSoldiers += op.woundedSoldiers;
  s.injuredCivilians += op.woundedCivilians;
  s.trucks += op.trucks;
  s.stock.ammo += op.ammo;
  restoreJobs(s);
  const got: string[] = [];
  let wasted = 0;
  for (const r of RESOURCES) {
    if (!op.cargo[r]) continue;
    const room = Math.max(0, cap(s, r) - s.stock[r]);
    const keep = Math.min(room, op.cargo[r]);
    s.stock[r] += keep;
    wasted += op.cargo[r] - keep;
    got.push(`${op.cargo[r]} ${r}`);
  }
  if (wasted > 0) {
    s.wasted += wasted;
    log(s, 'warn', `${wasted} supplies had nowhere to go and were left in the yard to rot.`);
  }
  if (op.carriesRelay) {
    s.hasRelay = true;
    log(s, 'good', 'The relay unit is home. Theo is already wiring it to the generator.');
  }
  const w = op.woundedSoldiers + op.woundedCivilians;
  log(s, got.length || op.kind !== 'scavenge' ? 'good' : 'info',
    `${opLabel(s, op)} is home${got.length ? ` with ${got.join(', ')}` : ''}${w ? ` (${w} wounded)` : ''}.`);
  if (got.length) moraleHit(s, -1);
}

function destroyOp(s: GameState, op: Operation): void {
  const lostWounded = op.woundedSoldiers + op.woundedCivilians;
  s.deaths += lostWounded;
  if (op.carriesRelay) s.flags.relayAtSite = 1;
  log(s, 'bad', `${opLabel(s, op)} has gone silent. The team is lost${op.trucks ? ' along with the trucks' : ''}.`);
  moraleHit(s, 6 + lostWounded * 2);
  s.trust = clamp(s.trust - 4, 0, 100);
  s.ops = s.ops.filter((o) => o !== op);
}

function advanceOps(s: GameState): void {
  for (const op of [...s.ops]) {
    op.legDay++;
    if (op.leg === 'site') {
      if (op.kind === 'scavenge') {
        scavengeDay(s, op);
        encounter(s, op, op.target, 1.5);
      } else if (op.kind === 'clear') {
        clearDay(s, op);
      } else {
        encounter(s, op, op.target, 0.6); // intercept: dug in, waiting
      }
      updateIntel(s, op.target);
      if (activeMembers(op) > 0 && op.legDay >= op.legLength) startBack(op);
    } else {
      encounter(s, op, opNode(op), op.kind === 'recon' ? 0.5 : 1);
      if (activeMembers(op) > 0 && op.legDay >= op.legLength) {
        if (op.leg === 'out') arrive(s, op);
        else {
          returnHome(s, op);
          s.ops = s.ops.filter((o) => o !== op);
          continue;
        }
      }
    }
    if (activeMembers(op) <= 0) destroyOp(s, op);
  }
}

/* ------------------------------------------------------------------ hordes */

function spot(s: GameState, h: Horde, how: string): void {
  if (h.spotted) return;
  h.spotted = true;
  h.spottedDay = s.day;
  log(s, 'warn', `Horde of ~${Math.round(h.size / 5) * 5} spotted at ${s.locations[h.at].name} ${how}.`);
}

function spawnHorde(s: GameState): void {
  const source = pick(s, HORDE_SOURCES);
  const size = Math.round(15 + s.day * 2.2 + int(s, 0, 12));
  const h: Horde = { id: s.nextId++, size, at: source, spotted: false, spottedDay: null };
  s.hordes.push(h);
  s.locations[source].threat = clamp(s.locations[source].threat + 1, 0, 10);
  s.nextHordeDay = s.day + int(s, 4, 6);
}

function hordeMeetsOps(s: GameState, h: Horde): void {
  for (const op of [...s.ops]) {
    if (h.size <= 0) return;
    if (opNode(op) !== h.at) continue;
    const dugIn = op.kind === 'intercept' && op.leg === 'site';
    if (!dugIn && op.leg !== 'site' && chance(s, 0.5)) continue; // slipped past on the road
    spot(s, h, `by ${opLabel(s, op)}`);
    const fp = opFirepower(op);
    const damage = Math.round(fp * (dugIn ? 1.6 : 0.8) * range(s, 0.8, 1.2));
    const before = h.size;
    h.size = Math.max(0, h.size - damage);
    log(s, dugIn ? 'good' : 'warn',
      `${opLabel(s, op)} ${dugIn ? 'ambushed' : 'collided with'} the horde: ${before - h.size} of ${before} dead put down.`);
    fight(s, op, before * (dugIn ? 0.35 : 0.6), s.locations[h.at].name);
    if (dugIn && activeMembers(op) > 0) startBack(op);
    if (activeMembers(op) <= 0) destroyOp(s, op);
  }
  if (h.size <= 0) log(s, 'good', `The horde at ${s.locations[h.at].name} has been destroyed.`);
}

function siege(s: GameState, h: Horde): void {
  s.sieges++;
  const warned = h.spottedDay !== null && h.spottedDay < s.day;
  if (!h.spotted) s.flags.unspotted = (s.flags.unspotted ?? 0) + 1;
  const mult = warned ? 1.1 : h.spotted ? 1 : 0.85;
  const defense = Math.round(baseDefense(s) * mult);
  const ammoUse = Math.min(s.stock.ammo, Math.round(h.size * 0.8));
  s.stock.ammo -= ammoUse;
  const surprise = h.spotted ? '' : ' It came out of nowhere.';
  if (defense >= h.size) {
    const hurt = Math.min(s.soldiers, Math.round((h.size / Math.max(1, defense)) * 2 * rand(s)));
    s.soldiers -= hurt;
    s.injuredSoldiers += hurt;
    normalizeJobs(s);
    log(s, 'good', `A horde of ${h.size} hit the walls and broke (defense ${defense}). ${ammoUse} rounds spent${hurt ? `, ${hurt} wounded` : ''}.${surprise}`);
    moraleHit(s, -4);
    s.trust = clamp(s.trust + 3, 0, 100);
  } else {
    s.breaches++;
    const deficit = h.size - defense;
    const dead = Math.ceil(deficit / 6);
    const hurt = Math.ceil(deficit / 8);
    const killed = killAtBase(s, dead);
    woundAtBase(s, hurt);
    for (const r of RESOURCES) s.stock[r] = Math.floor(s.stock[r] * 0.82);
    log(s, 'bad', `The horde (${h.size}) broke through (defense ${defense}). ${killed} dead, ${hurt} wounded, stores ransacked.${surprise}`);
    moraleHit(s, 15);
    s.trust = clamp(s.trust - 8, 0, 100);
  }
  if (s.sieges === 1 && s.garrisonMin < 6) {
    s.garrisonMin = 6;
    log(s, 'info', 'Standing order updated: the Commander wants at least 6 soldiers at base from now on.');
  }
}

function moveHordes(s: GameState): void {
  for (const h of [...s.hordes]) {
    const path = pathBetween(s, h.at, BASE_ID);
    const next = path[0] ?? BASE_ID;
    if (next === BASE_ID) {
      s.hordes = s.hordes.filter((x) => x !== h);
      siege(s, h);
      continue;
    }
    h.at = next;
    const loc = s.locations[h.at];
    loc.threat = clamp(loc.threat + 0.4, 0, 10);
    hordeMeetsOps(s, h);
    if (h.size <= 0) {
      s.hordes = s.hordes.filter((x) => x !== h);
      continue;
    }
    if (hops(s, h.at) <= spotRange(s)) spot(s, h, 'from the quarry');
  }
}

/* --------------------------------------------------------------- the base */

function moraleHit(s: GameState, amount: number): void {
  const damp = amount > 0 && s.facilities.commons ? 0.75 : 1;
  s.morale = clamp(s.morale - amount * damp, 0, 100);
}

function killAtBase(s: GameState, n: number): number {
  let k = 0;
  for (; k < n; k++) {
    if (s.injuredCivilians > 0 && chance(s, 0.3)) s.injuredCivilians--;
    else if (s.civilians > 0 && (s.soldiers === 0 || chance(s, 0.65))) s.civilians--;
    else if (s.soldiers > 0) s.soldiers--;
    else if (s.injuredSoldiers > 0) s.injuredSoldiers--;
    else if (s.injuredCivilians > 0) s.injuredCivilians--;
    else break;
  }
  s.deaths += k;
  normalizeJobs(s);
  moraleHit(s, k * 3);
  s.trust = clamp(s.trust - Math.min(6, k), 0, 100);
  return k;
}

function woundAtBase(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (s.soldiers > 0 && chance(s, 0.5)) {
      s.soldiers--;
      s.injuredSoldiers++;
    } else if (s.civilians > 0) {
      s.civilians--;
      s.injuredCivilians++;
    }
  }
  normalizeJobs(s);
}

export function productivity(s: GameState): number {
  return s.morale < 25 ? 0.75 : s.morale > 70 ? 1.1 : 1;
}

/** Expected per-day change at base, used by the UI and by the day tick. */
export function forecast(s: GameState): Stock {
  const m = productivity(s);
  const f = s.facilities;
  const eat = atBase(s);
  const armory = Math.min(4 * f.armory, s.stock.parts + s.jobs.workshop * 0.8 * m);
  return {
    food: s.jobs.farm * (2 + f.garden) * m - eat,
    water: s.jobs.water * (4 + 2 * f.purifier) * m + 5 * f.purifier - eat,
    fuel: -GENERATOR_FUEL,
    ammo: armory * 3,
    meds: -Math.min(injured(s), s.jobs.medic * (2 + f.infirmary)),
    parts: s.jobs.workshop * 0.8 * m - armory,
  };
}

function baseDay(s: GameState): void {
  const fc = forecast(s);
  const eat = atBase(s);
  // Production & consumption
  for (const r of ['food', 'water', 'ammo', 'parts'] as const) s.stock[r] += fc[r];

  if (s.stock.fuel >= GENERATOR_FUEL) {
    s.stock.fuel -= GENERATOR_FUEL;
  } else {
    s.stock.fuel = 0;
    moraleHit(s, 3);
    log(s, 'bad', 'The generator is dry. Cold food and dark nights.');
  }

  for (const r of ['food', 'water'] as const) {
    if (s.stock[r] < 0) {
      const short = -s.stock[r];
      s.stock[r] = 0;
      s.flags[`short_${r}`] = (s.flags[`short_${r}`] ?? 0) + 1;
      moraleHit(s, r === 'water' ? 10 : 7);
      log(s, 'bad', `${r === 'food' ? 'Food' : 'Water'} ran out: ${Math.ceil(short)} people went without.`);
      const days = s.flags[`short_${r}`];
      if (days >= (r === 'water' ? 2 : 3)) {
        const k = killAtBase(s, Math.max(1, Math.round(short / 12)));
        if (k) log(s, 'bad', `${k} ${k === 1 ? 'person' : 'people'} died of ${r === 'water' ? 'thirst' : 'hunger'}.`);
      }
    } else {
      s.flags[`short_${r}`] = 0;
    }
  }
  if (eat === 0) return;

  // Medicine
  const f = s.facilities;
  let canTreat = Math.min(s.jobs.medic * (2 + f.infirmary), Math.floor(s.stock.meds));
  const pTreated = 0.35 + 0.2 * f.infirmary;
  const pDie = f.infirmary ? 0.03 : 0.07;
  let recovered = 0;
  let died = 0;
  const heal = (isSoldier: boolean) => {
    const n = isSoldier ? s.injuredSoldiers : s.injuredCivilians;
    for (let i = 0; i < n; i++) {
      const treated = canTreat > 0;
      if (treated) {
        canTreat--;
        s.stock.meds--;
      }
      const roll = rand(s);
      if (roll < (treated ? pTreated : 0.1)) {
        recovered++;
        if (isSoldier) { s.injuredSoldiers--; s.soldiers++; } else { s.injuredCivilians--; s.civilians++; restoreJobs(s); }
      } else if (!treated && roll > 1 - pDie) {
        died++;
        if (isSoldier) s.injuredSoldiers--; else s.injuredCivilians--;
      }
    }
  };
  heal(true);
  heal(false);
  if (recovered) log(s, 'good', `${recovered} wounded back on their feet.`);
  if (died) {
    s.deaths += died;
    moraleHit(s, died * 3);
    log(s, 'bad', `${died} untreated wounded died in the night.`);
  }

  // Construction
  let work = s.jobs.build * productivity(s);
  for (const p of [...s.projects]) {
    if (work <= 0) break;
    const add = Math.min(work, p.work - p.workDone);
    p.workDone += add;
    work -= add;
    if (p.workDone >= p.work - 1e-6) {
      s.facilities[p.facility] = p.level;
      s.projects = s.projects.filter((x) => x !== p);
      log(s, 'good', `${FACILITIES[p.facility].name}${p.level > 1 ? ` (level ${p.level})` : ''} is finished.`);
      moraleHit(s, -3);
    }
  }

  // Motor pool repairs
  if (f.motorpool && s.brokenTrucks > 0 && s.stock.parts >= 10) {
    s.flags.repair = (s.flags.repair ?? 0) + 1;
    if (s.flags.repair >= 3) {
      s.flags.repair = 0;
      s.stock.parts -= 10;
      s.brokenTrucks--;
      s.trucks++;
      log(s, 'good', 'The motor pool has a truck running again.');
    }
  }

  // Storage limits
  for (const r of RESOURCES) {
    const c = cap(s, r);
    if (s.stock[r] > c) {
      s.wasted += s.stock[r] - c;
      s.stock[r] = c;
    }
    s.stock[r] = Math.max(0, r === 'food' || r === 'water' || r === 'parts' ? r1(s.stock[r]) : Math.floor(s.stock[r]));
  }

  // Morale
  const pop = population(s);
  if (pop > housing(s)) {
    moraleHit(s, 3);
    log(s, 'warn', `Overcrowded: ${pop} people, bunks for ${housing(s)}.`);
  }
  const target = 50 + (f.commons ? 10 : 0);
  s.morale = clamp(s.morale + Math.sign(target - s.morale) + (f.commons ? 2 : 0), 0, 100);
  if (s.morale < 20 && s.civilians > 0 && chance(s, 0.5)) {
    const n = Math.min(s.civilians, int(s, 1, 2));
    s.civilians -= n;
    normalizeJobs(s);
    log(s, 'bad', `${n} ${n === 1 ? 'civilian' : 'civilians'} slipped out of the gate overnight and did not come back.`);
  }
}

/* ------------------------------------------------------------- the needs */

export function canApprove(s: GameState, n: NeedRequest): boolean {
  return s.stock.parts >= n.parts;
}

export function approveNeed(s: GameState, id: number): string | null {
  const n = s.needs.find((x) => x.id === id);
  if (!n) return 'Unknown request.';
  if (!canApprove(s, n)) return `Needs ${n.parts} parts.`;
  s.stock.parts -= n.parts;
  s.projects.push({ facility: n.facility, level: n.level, work: n.work, workDone: 0 });
  s.needs = s.needs.filter((x) => x !== n);
  s.needHistory[n.facility] = { last: s.day, dismissed: s.needHistory[n.facility]?.dismissed ?? 0 };
  moraleHit(s, -2);
  if (n.commanderBacked) s.trust = clamp(s.trust + 2, 0, 100);
  s.log.push({ day: s.day, tone: 'good', text: `Approved: ${FACILITIES[n.facility].name}. ${n.work} work-days queued.` });
  return null;
}

export function dismissNeed(s: GameState, id: number, ignored = false): void {
  const n = s.needs.find((x) => x.id === id);
  if (!n) return;
  s.needs = s.needs.filter((x) => x !== n);
  const h = s.needHistory[n.facility] ?? { last: 0, dismissed: 0 };
  s.needHistory[n.facility] = { last: s.day, dismissed: h.dismissed + 1 };
  moraleHit(s, (n.repeat > 0 ? 5 : 3) + (ignored ? 2 : 0));
  if (n.commanderBacked) s.trust = clamp(s.trust - 6, 0, 100);
  const line = {
    day: s.day,
    tone: 'warn' as const,
    text: `${ignored ? 'Ignored' : 'Dismissed'}: "${n.title}"${n.commanderBacked ? ' (the Commander noticed)' : ''}.`,
  };
  if (ignored) log(s, line.tone, line.text); else s.log.push(line);
}

function raiseNeeds(s: GameState): void {
  let raised = 0;
  for (const fid of FACILITY_ORDER) {
    if (raised >= 2) break;
    const def = FACILITIES[fid];
    const level = s.facilities[fid];
    if (level >= def.levels.length) continue;
    if (s.needs.some((n) => n.facility === fid) || s.projects.some((p) => p.facility === fid)) continue;
    const hist = s.needHistory[fid];
    if (hist && s.day - hist.last < (hist.dismissed ? 6 : 2)) continue;
    const lvl = def.levels[level];
    if (!lvl.trigger(s)) continue;
    const repeat = hist?.dismissed ?? 0;
    const need: NeedRequest = {
      id: s.nextId++,
      facility: fid,
      level: level + 1,
      speaker: def.speaker,
      title: lvl.title,
      text: repeat ? `${lvl.text} I am asking again.` : lvl.text,
      parts: lvl.parts,
      work: lvl.work,
      expires: s.day + 4,
      commanderBacked: !!lvl.backed,
      repeat,
    };
    s.needs.push(need);
    raised++;
    log(s, 'info', `New request from ${def.speaker}: "${lvl.title}".`);
  }
}

/* --------------------------------------------------------------- decisions */

function addDecision(s: GameState, d: Omit<Decision, 'id'>): void {
  s.decisions.push({ ...d, id: s.nextId++ });
}

function rollEvents(s: GameState): void {
  if (s.day < 2) return;
  // Automatic happenings
  if (chance(s, 0.12)) {
    const w = int(s, 25, 45);
    s.stock.water = Math.min(cap(s, 'water'), s.stock.water + w);
    log(s, 'good', `Heavy rain overnight. The barrels caught ${w} water.`);
  }
  if (s.trucks > 0 && chance(s, 0.07)) {
    s.trucks--;
    s.brokenTrucks++;
    log(s, 'bad', 'A truck threw a rod in the yard. It is not going anywhere.');
  }
  if (chance(s, 0.1)) {
    const unknown = Object.values(s.locations).filter((l) => !l.intel);
    if (unknown.length) {
      const l = pick(s, unknown);
      updateIntel(s, l.id);
      log(s, 'info', `Radio chatter from another group described ${l.name}. Intel updated.`);
    }
  }
  if (!chance(s, 0.5)) return;

  const pool: (() => boolean)[] = [
    () => {
      if (population(s) > housing(s) + 6) return false;
      const n = int(s, 3, 7);
      const hurt = int(s, 0, 2);
      addDecision(s, {
        title: 'Survivors at the gate',
        text: `${n} people are at the gate asking to come in${hurt ? `, ${hurt} of them hurt` : ''}. They have nothing with them.`,
        options: [
          { label: 'Let them all in', hint: `+${n} people`, effect: 'refugees_all' },
          ...(hurt ? [{ label: 'Only the able-bodied', hint: `+${n - hurt} people, morale −2`, effect: 'refugees_fit' }] : []),
          { label: 'Turn them away', hint: 'Morale −5', effect: 'refugees_none' },
        ],
        payload: { n, hurt },
      });
      return true;
    },
    () => {
      const offers: [Res, number, Res, number][] = [
        ['ammo', 40, 'food', 50], ['food', 40, 'fuel', 35], ['parts', 30, 'meds', 12],
        ['fuel', 30, 'ammo', 45], ['water', 50, 'parts', 30], ['meds', 8, 'ammo', 50],
      ];
      const [give, gn, get, gm] = pick(s, offers);
      addDecision(s, {
        title: 'A trader on the road',
        text: `A two-truck caravan is offering ${gm} ${get} in exchange for ${gn} ${give}. They leave at dawn.`,
        options: [
          { label: 'Make the trade', hint: `−${gn} ${give}, +${gm} ${get}`, effect: 'trade' },
          { label: 'Send them on', effect: 'none' },
        ],
        payload: { give: RESOURCES.indexOf(give), gn, get: RESOURCES.indexOf(get), gm },
      });
      return true;
    },
    () => {
      if (s.stock.food < 40) return false;
      addDecision(s, {
        title: 'Food going missing',
        text: 'The night count on the pantry is short again. Someone is skimming.',
        options: [
          { label: 'Search the bunks', hint: 'Morale −4', effect: 'theft_search' },
          { label: 'Let it go', hint: '−25 food', effect: 'theft_ignore' },
        ],
        payload: {},
      });
      return true;
    },
    () => {
      if (s.civilians < 6) return false;
      const n = int(s, 2, 4);
      addDecision(s, {
        title: 'Fever in the bunkhouse',
        text: `${n} people are running a fever. Dr. Okafor wants to treat it now, before it spreads.`,
        options: [
          { label: 'Treat it', hint: `−${n * 2} meds`, effect: 'fever_treat' },
          { label: 'Isolate and wait', hint: `${n} civilians laid up`, effect: 'fever_isolate' },
        ],
        payload: { n },
      });
      return true;
    },
    () => {
      if (s.civilians < 8) return false;
      addDecision(s, {
        title: 'Volunteers for the militia',
        text: 'Two of the younger civilians want to carry rifles. Sgt. Ruiz can train them, but drills burn ammunition.',
        options: [
          { label: 'Train them', hint: '2 civilians → soldiers, −20 ammo', effect: 'militia' },
          { label: 'Not now', hint: 'Morale −1', effect: 'militia_no' },
        ],
        payload: {},
      });
      return true;
    },
    () => {
      if (s.flags.patrolAsked || s.day < 7) return false;
      s.flags.patrolAsked = 1;
      addDecision(s, {
        title: 'The Commander wants a patrol',
        text: 'The Commander wants a standing perimeter patrol: two more soldiers kept at base at all times.',
        options: [
          { label: 'Yes, Commander', hint: 'Garrison minimum +2, trust +5', effect: 'patrol_yes' },
          { label: 'Push back: we need them in the field', hint: 'Trust −6', effect: 'patrol_no' },
        ],
        payload: {},
      });
      return true;
    },
  ];
  // Shuffle-pick the first event whose conditions hold.
  const order = pool.map((fn) => ({ fn, k: rand(s) })).sort((a, b) => a.k - b.k);
  for (const o of order) if (o.fn()) break;
}

export function answerDecision(s: GameState, id: number, optionIndex: number): void {
  const d = s.decisions.find((x) => x.id === id);
  if (!d) return;
  const opt = d.options[optionIndex] ?? d.options[d.options.length - 1];
  const p = d.payload;
  const note = (tone: LogTone, text: string) => s.log.push({ day: s.day, tone, text });
  switch (opt.effect) {
    case 'refugees_all':
      s.civilians += p.n - p.hurt;
      s.injuredCivilians += p.hurt;
      moraleHit(s, -2);
      note('good', `${p.n} newcomers took bunks at ${s.baseName}.`);
      break;
    case 'refugees_fit':
      s.civilians += p.n - p.hurt;
      moraleHit(s, 2);
      note('warn', `${p.n - p.hurt} newcomers admitted. The wounded were turned away.`);
      break;
    case 'refugees_none':
      moraleHit(s, 5);
      note('warn', 'The gate stayed shut.');
      break;
    case 'trade': {
      const give = RESOURCES[p.give];
      const get = RESOURCES[p.get];
      if (s.stock[give] >= p.gn) {
        s.stock[give] -= p.gn;
        s.stock[get] = Math.min(cap(s, get), s.stock[get] + p.gm);
        note('good', `Traded ${p.gn} ${give} for ${p.gm} ${get}.`);
      } else {
        note('warn', `We did not have ${p.gn} ${give}. The trader left.`);
      }
      break;
    }
    case 'theft_search':
      moraleHit(s, 4);
      note('info', 'A stash was found under a bunk. Words were had.');
      break;
    case 'theft_ignore':
      s.stock.food = Math.max(0, s.stock.food - 25);
      note('warn', 'The pantry came up 25 short.');
      break;
    case 'fever_treat':
      if (s.stock.meds >= p.n * 2) {
        s.stock.meds -= p.n * 2;
        note('good', 'The fever broke within a day.');
      } else {
        const n = Math.min(p.n, s.civilians);
        s.civilians -= n;
        s.injuredCivilians += n;
        normalizeJobs(s);
        note('bad', 'Not enough medicine. The sick were laid up anyway.');
      }
      break;
    case 'fever_isolate': {
      const n = Math.min(p.n, s.civilians);
      s.civilians -= n;
      s.injuredCivilians += n;
      normalizeJobs(s);
      note('warn', `${n} civilians are laid up with fever.`);
      break;
    }
    case 'militia':
      if (s.civilians >= 2 && s.stock.ammo >= 20) {
        s.civilians -= 2;
        s.soldiers += 2;
        s.stock.ammo -= 20;
        normalizeJobs(s);
        note('good', 'Two new soldiers joined the garrison.');
      }
      break;
    case 'militia_no':
      moraleHit(s, 1);
      break;
    case 'patrol_yes':
      s.garrisonMin += 2;
      s.trust = clamp(s.trust + 5, 0, 100);
      note('info', `Standing order: keep ${s.garrisonMin} soldiers at base.`);
      break;
    case 'patrol_no':
      s.trust = clamp(s.trust - 6, 0, 100);
      note('warn', 'The Commander did not like that answer.');
      break;
    default:
      break;
  }
  s.decisions = s.decisions.filter((x) => x !== d);
}

/* -------------------------------------------------------------- directives */

function issueDirectives(s: GameState): void {
  if (s.directive) return;
  const idx = s.flags.nextDirective ?? 0;
  const def = DIRECTIVES[idx];
  if (!def || s.day < def.issueDay) return;
  const deadline = idx === DIRECTIVES.length - 1 ? FINAL_DAY : s.day + def.window - 1;
  s.directive = { index: idx, issued: s.day, deadline };
  s.flags.nextDirective = idx + 1;
  log(s, 'info', `New directive from the Commander: "${def.title}" (due day ${deadline}).`);
}

function checkDirective(s: GameState): void {
  const d = s.directive;
  if (!d) return;
  const def = DIRECTIVES[d.index];
  if (def.check(s)) {
    s.trust = clamp(s.trust + def.reward, 0, 100);
    moraleHit(s, -3);
    s.directivesDone++;
    s.directive = null;
    log(s, 'good', `Directive complete: "${def.title}". The Commander is pleased (trust +${def.reward}).`);
  } else if (s.day >= d.deadline && d.index < DIRECTIVES.length - 1) {
    s.trust = clamp(s.trust - 10, 0, 100);
    s.directivesFailed++;
    s.directive = null;
    log(s, 'bad', `Directive failed: "${def.title}". The Commander is not pleased (trust −10).`);
  }
}

/* -------------------------------------------------------------- end of day */

export function blockingDecisions(s: GameState): number {
  return s.decisions.length;
}

export function garrisonShort(s: GameState): boolean {
  return s.soldiers < s.garrisonMin;
}

export function endDay(s: GameState): DayReport {
  report = { day: s.day, lines: [] };
  if (s.over) return report;
  // Unanswered decisions take their last (most passive) option.
  for (const d of [...s.decisions]) answerDecision(s, d.id, d.options.length - 1);

  baseDay(s);
  advanceOps(s);
  if (s.day >= s.nextHordeDay) spawnHorde(s);
  moveHordes(s);

  // Location regrowth
  for (const loc of Object.values(s.locations)) {
    for (const r of RESOURCES) {
      const g = loc.regen[r];
      if (g) loc.stock[r] = Math.min(200, loc.stock[r] + g);
    }
  }

  if (garrisonShort(s)) {
    s.trust = clamp(s.trust - 2, 0, 100);
    log(s, 'warn', `Only ${s.soldiers} soldiers at base against a standing order of ${s.garrisonMin}. The Commander noticed (trust −2).`);
  }

  checkDirective(s);

  for (const n of [...s.needs]) if (s.day >= n.expires) dismissNeed(s, n.id, true);

  // Ending conditions
  if (population(s) <= 0) {
    s.over = { won: false, title: `${s.baseName} has fallen`, text: 'There is no one left to give orders to.' };
  } else if (s.trust <= 0) {
    s.over = {
      won: false,
      title: 'Relieved of command',
      text: 'The Commander has lost all confidence in you. Someone else will run the logistics now. You will be on the farm crew.',
    };
  } else if (s.day >= FINAL_DAY) {
    s.over = finalVerdict(s);
  }
  if (s.over) {
    log(s, s.over.won ? 'good' : 'bad', s.over.title);
    return report;
  }

  s.day++;
  report.lines.push({ day: s.day, tone: 'info', text: `— Day ${s.day} begins —` });
  s.wasted = Math.max(0, s.wasted - 20);
  issueDirectives(s);
  raiseNeeds(s);
  rollEvents(s);
  return report;
}

function finalVerdict(s: GameState): NonNullable<GameState['over']> {
  const pop = population(s);
  if (pop < 20) {
    return {
      won: false,
      title: 'Too few left',
      text: `When the relief window came, only ${pop} people were left at ${s.baseName}. The Commander's report does not mention your name.`,
    };
  }
  if (!s.hasRelay) {
    return {
      won: true,
      title: 'Holding, alone',
      text: `${pop} people made it to day ${FINAL_DAY}. Without the relay, no relief column knows you are here, but the walls are standing and the larder is not empty. It is a start.`,
    };
  }
  const grade = s.trust >= 75 ? 'The Commander puts you forward for command of the next outpost.' : 'The Commander shakes your hand. That is more than most get.';
  return {
    won: true,
    title: 'Relief has arrived',
    text: `The relay got the call out. On day ${FINAL_DAY} a relief column rolled up the quarry road to find ${pop} people alive. ${grade}`,
  };
}

/* ------------------------------------------------------------------ saves */

const SAVE_KEY = 'sic-save-v1';

export function save(s: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the game still runs, it just will not resume */
  }
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return s.version === SAVE_VERSION ? s : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

