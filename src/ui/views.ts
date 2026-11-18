import { DIRECTIVES, FACILITIES, FACILITY_ORDER, FINAL_DAY } from '../game/data';
import {
  BASE_ID, atBase, baseDefense, cap, estimateRisk, fieldPeople, haulCapacity, hops, housing, idleCivilians,
  injured, knownThreat, opFirepower, pathBetween, population, spotRange, stockTotal,
} from '../game/derived';
import {
  forecast, garrisonShort, opNode, planDays, planFuel, planRations, productivity, validatePlan, type OpPlan,
} from '../game/engine';
import type { DayReport, GameState, Job, LogLine, OpKind, Operation, Res } from '../game/types';
import { JOBS, RESOURCES } from '../game/types';
import { ICON, RES_ICON } from './icons';

export type Tab = 'hq' | 'map' | 'ops' | 'base' | 'log';

export interface UiState {
  tab: Tab;
  selected: string | null;
  plan: OpPlan | null;
  modal: null | { kind: 'report'; report: DayReport } | { kind: 'intro' } | { kind: 'confirm-new' } | { kind: 'over' } | { kind: 'help' };
  flash: string | null;
}

export const esc = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const n0 = (v: number) => Math.floor(v + 1e-6).toString();
const signed = (v: number) => (v > 0.05 ? `+${v.toFixed(Math.abs(v) < 10 && v % 1 ? 1 : 0)}` : v < -0.05 ? v.toFixed(Math.abs(v) < 10 && v % 1 ? 1 : 0).replace('-', '−') : '±0');

const RES_LABEL: Record<Res, string> = { food: 'Food', water: 'Water', fuel: 'Fuel', ammo: 'Ammo', meds: 'Meds', parts: 'Parts' };
const JOB_LABEL: Record<Job, [string, string]> = {
  farm: ['Farming', 'farmers'],
  water: ['Water hauling', 'haulers'],
  workshop: ['Workshop', 'mechanics'],
  build: ['Construction', 'builders'],
  medic: ['Medical', 'medics'],
};
const KIND_LABEL: Record<OpKind, string> = { scavenge: 'Supply run', recon: 'Recon', clear: 'Clear area', intercept: 'Intercept' };
const KIND_HELP: Record<OpKind, string> = {
  scavenge: 'Haul supplies home. More hands gather faster; trucks carry the load.',
  recon: 'Up to 3 people, quiet and quick. Reveals the site and every road out of it.',
  clear: 'Soldiers fight the site down. Lower threat means safer runs later.',
  intercept: 'Dig in on a horde’s route and ambush it before it reaches the walls.',
};

export function threatClass(t: number | null): string {
  if (t === null) return 't-unknown';
  if (t < 2) return 't-low';
  if (t < 4) return 't-mid';
  if (t < 6) return 't-high';
  return 't-severe';
}

function bar(value: number, max: number, cls = ''): string {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return `<span class="bar ${cls}"><span style="width:${pct.toFixed(1)}%"></span></span>`;
}

/* ------------------------------------------------------------------ header */

export function header(s: GameState): string {
  const fc = forecast(s);
  const chips = RESOURCES.map((r) => {
    const low = r === 'food' || r === 'water' ? s.stock[r] < atBase(s) * 2 : r === 'fuel' ? s.stock.fuel < 12 : r === 'ammo' ? s.stock.ammo < 60 : false;
    const d = fc[r];
    return `<div class="chip ${low ? 'chip-low' : ''}" title="${RES_LABEL[r]}">
      ${RES_ICON[r]}<b>${n0(s.stock[r])}</b><i class="${d < -0.05 ? 'neg' : d > 0.05 ? 'pos' : ''}">${signed(d)}</i>
    </div>`;
  }).join('');
  return `<header class="top">
    <div class="top-row">
      <div class="day"><span>Day</span><b>${s.day}</b><span class="of">/ ${FINAL_DAY}</span></div>
      <div class="meters">
        <div class="meter"><label>Trust</label>${bar(s.trust, 100, s.trust < 25 ? 'warn' : 'trust')}<b>${Math.round(s.trust)}</b></div>
        <div class="meter"><label>Morale</label>${bar(s.morale, 100, s.morale < 25 ? 'warn' : 'morale')}<b>${Math.round(s.morale)}</b></div>
      </div>
      <button class="icon-btn" data-a="help" aria-label="How to play">?</button>
    </div>
    <div class="chips">${chips}</div>
  </header>`;
}

/* --------------------------------------------------------------------- HQ */

function directiveCard(s: GameState): string {
  const d = s.directive;
  if (!d) {
    const next = DIRECTIVES[s.flags.nextDirective ?? 0];
    return `<section class="card directive quiet">
      <div class="eyebrow">Commander's directive</div>
      <p class="muted">No standing directive. ${next ? `Expect new orders by day ${Math.max(next.issueDay, s.day + 1)}.` : ''}</p>
    </section>`;
  }
  const def = DIRECTIVES[d.index];
  const left = d.deadline - s.day;
  return `<section class="card directive">
    <div class="eyebrow">Commander's directive · ${d.index + 1}/${DIRECTIVES.length}</div>
    <h2>${esc(def.title)}</h2>
    <p class="quote">“${esc(def.text)}”</p>
    <div class="row between">
      <span class="pill">${esc(def.progress(s))}</span>
      <span class="${left <= 1 ? 'neg' : 'muted'}">${left <= 0 ? 'Due today' : `Due day ${d.deadline} · ${left}d left`}</span>
    </div>
  </section>`;
}

function standingOrder(s: GameState): string {
  const short = garrisonShort(s);
  return `<section class="card slim ${short ? 'alert' : ''}">
    <div class="row between">
      <div><div class="eyebrow">Standing order</div>Keep at least <b>${s.garrisonMin}</b> soldiers at base</div>
      <div class="big ${short ? 'neg' : 'pos'}">${s.soldiers}/${s.garrisonMin}</div>
    </div>
    ${short ? '<p class="small neg">Below the minimum: trust drops every night this stays true.</p>' : ''}
  </section>`;
}

function decisionCards(s: GameState): string {
  return s.decisions.map((d) => `<section class="card decision">
    <div class="eyebrow warn-text">${ICON.alert} Decision needed</div>
    <h3>${esc(d.title)}</h3>
    <p>${esc(d.text)}</p>
    <div class="choices">${d.options.map((o, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-a="dec" data-id="${d.id}" data-i="${i}">
      <span>${esc(o.label)}</span>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</button>`).join('')}</div>
  </section>`).join('');
}

function needCards(s: GameState): string {
  if (!s.needs.length) return '';
  return `<h4 class="section-title">Requests from the base</h4>` + s.needs.map((n) => {
    const def = FACILITIES[n.facility];
    const left = n.expires - s.day;
    const affordable = s.stock.parts >= n.parts;
    const builders = Math.max(1, s.jobs.build);
    return `<section class="card need">
      <div class="row between"><div class="eyebrow">${esc(n.speaker)}</div>${n.commanderBacked ? `<span class="tag">${ICON.star} Commander backs this</span>` : ''}</div>
      <h3>${esc(n.title)}</h3>
      <p>${esc(n.text)}</p>
      <div class="need-meta">
        <span>${esc(def.name)}${n.level > 1 ? ` · level ${n.level}` : ''}: <em>${esc(def.effect(n.level))}</em></span>
        <span>${RES_ICON.parts}<b class="${affordable ? '' : 'neg'}">${n.parts}</b> parts · ${n.work} work-days ${s.jobs.build ? `(~${Math.ceil(n.work / builders)}d with ${builders} builder${builders > 1 ? 's' : ''})` : '(no builders assigned yet)'}</span>
        <span class="${left <= 1 ? 'neg' : 'muted'}">${left <= 0 ? 'Answer today' : `Answer within ${left + 1} days`}${n.repeat ? ` · asked ${n.repeat + 1} times` : ''}</span>
      </div>
      <div class="row gap">
        <button class="btn primary grow" data-a="need-ok" data-id="${n.id}" ${affordable ? '' : 'disabled'}>Approve</button>
        <button class="btn grow" data-a="need-no" data-id="${n.id}">Dismiss</button>
      </div>
    </section>`;
  }).join('');
}

function threatBoard(s: GameState): string {
  const seen = s.hordes.filter((h) => h.spotted);
  if (!seen.length) {
    return `<section class="card slim"><div class="eyebrow">Threat board</div><p class="muted small">No hordes sighted. Lookouts can see ${spotRange(s)} road${spotRange(s) > 1 ? 's' : ''} out.</p></section>`;
  }
  return `<section class="card slim alert"><div class="eyebrow">Threat board</div>${seen.map((h) => {
    const eta = hops(s, h.at);
    return `<div class="row between horde-row"><span>${ICON.alert} Horde of ~${Math.round(h.size / 5) * 5} at <b>${esc(s.locations[h.at].name)}</b></span><span class="${eta <= 1 ? 'neg' : 'warn-text'}">${eta <= 1 ? 'Hits tonight' : `~${eta} days out`}</span></div>`;
  }).join('')}<p class="small muted">Base defense now: <b>${baseDefense(s)}</b></p></section>`;
}

export function hqView(s: GameState): string {
  return `${decisionCards(s)}${directiveCard(s)}${threatBoard(s)}${standingOrder(s)}${needCards(s)}
  ${!s.needs.length && !s.decisions.length ? '<p class="muted center small pad">No requests on your desk. The base will tell you what it needs.</p>' : ''}`;
}

/* -------------------------------------------------------------------- map */

export function mapView(s: GameState, ui: UiState): string {
  const locs = Object.values(s.locations);
  const route = ui.selected ? new Set([BASE_ID, ...pathBetween(s, BASE_ID, ui.selected)]) : new Set<string>();
  const edges: string[] = [];
  const done = new Set<string>();
  for (const l of locs) {
    for (const n of l.links) {
      const key = [l.id, n].sort().join('|');
      if (done.has(key)) continue;
      done.add(key);
      const m = s.locations[n];
      const on = route.has(l.id) && route.has(n);
      edges.push(`<line x1="${l.x}" y1="${l.y}" x2="${m.x}" y2="${m.y}" class="edge ${on ? 'on' : ''}"/>`);
    }
  }
  const nodes = locs.map((l) => {
    const t = knownThreat(s, l.id);
    const isBase = l.id === BASE_ID;
    const sel = ui.selected === l.id;
    const labelBelow = l.y < 125;
    return `<g class="node ${threatClass(isBase ? null : t)} ${isBase ? 'base' : ''} ${sel ? 'sel' : ''}" data-a="sel" data-id="${l.id}">
      <circle class="hit" cx="${l.x}" cy="${l.y}" r="8"/>
      ${isBase ? `<rect x="${l.x - 4.5}" y="${l.y - 4.5}" width="9" height="9" rx="1.5" class="dot"/>` : `<circle cx="${l.x}" cy="${l.y}" r="3.8" class="dot"/>`}
      ${sel ? `<circle cx="${l.x}" cy="${l.y}" r="6.5" class="ring"/>` : ''}
      <text x="${l.x}" y="${labelBelow ? l.y + 9 : l.y - 6.5}" class="lbl">${esc(l.name.replace("St. Brigid's Hospital", "St. Brigid's").replace('Reservoir Pumphouse', 'Reservoir').replace('Hilltop Relay Station', 'Hilltop Relay').replace('Route 9 Gas & Go', 'Route 9 Gas'))}</text>
      ${!isBase && t !== null ? `<text x="${l.x}" y="${l.y + 1.3}" class="tnum">${Math.round(t)}</text>` : ''}
    </g>`;
  }).join('');
  const opsAt: Record<string, number> = {};
  const opMarks = s.ops.map((op) => {
    const at = opNode(op);
    const k = (opsAt[at] = (opsAt[at] ?? 0) + 1);
    const l = s.locations[at];
    const x = l.x - 6 - (k - 1) * 4;
    const y = l.y - 5;
    return `<g class="opmark"><path d="M${x} ${y - 2.4} L${x + 2.4} ${y + 2} L${x - 2.4} ${y + 2} Z"/></g>`;
  }).join('');
  const hordeMarks = s.hordes.filter((h) => h.spotted).map((h) => {
    const l = s.locations[h.at];
    const x = l.x + 6.5;
    const y = l.y - 5;
    return `<g class="hordemark"><path d="M${x} ${y - 3} L${x + 3} ${y} L${x} ${y + 3} L${x - 3} ${y} Z"/><text x="${x + 4}" y="${y + 1.2}">${Math.round(h.size)}</text></g>`;
  }).join('');

  return `<div class="map-wrap">
    <svg class="map" viewBox="0 0 100 142" role="img" aria-label="Regional map">
      <defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" class="grid"/></pattern></defs>
      <rect x="0" y="0" width="100" height="142" fill="url(#grid)"/>
      ${edges.join('')}${nodes}${opMarks}${hordeMarks}
    </svg>
    <div class="legend small muted">
      <span><i class="lg t-low"></i>calm</span><span><i class="lg t-mid"></i>risky</span><span><i class="lg t-high"></i>dangerous</span><span><i class="lg t-severe"></i>deadly</span><span><i class="lg t-unknown"></i>no intel</span>
      <span><i class="lg op"></i>team</span><span><i class="lg horde"></i>horde</span>
    </div>
  </div>
  ${ui.selected ? locationPanel(s, ui.selected) : '<p class="muted center small pad">Tap a site to see intel and send a team.</p>'}`;
}

function locationPanel(s: GameState, id: string): string {
  const l = s.locations[id];
  if (id === BASE_ID) {
    return `<section class="card"><div class="eyebrow">Home</div><h3>${esc(l.name)}</h3><p>${esc(l.note)}</p>
      <p class="small muted">Defense ${baseDefense(s)} · ${atBase(s)} people at base · ${s.trucks} trucks ready</p></section>`;
  }
  const h = hops(s, id);
  const intel = l.intel;
  const hordesHere = s.hordes.filter((x) => x.spotted && x.at === id);
  const teams = s.ops.filter((o) => o.target === id);
  const stockRows = intel
    ? RESOURCES.filter((r) => intel.stock[r] > 0).map((r) => `<span class="stk">${RES_ICON[r]}${intel.stock[r] >= 900 ? '∞' : intel.stock[r]}</span>`).join('') || '<span class="muted">Picked clean</span>'
    : '';
  return `<section class="card loc">
    <div class="row between"><div class="eyebrow">${esc(l.kind)} · ${h} road${h > 1 ? 's' : ''} out</div>
      ${intel ? `<span class="tag ${threatClass(intel.threat)}">Threat ${intel.threat.toFixed(1)}</span>` : '<span class="tag t-unknown">No intel</span>'}</div>
    <h3>${esc(l.name)}</h3>
    <p>${esc(l.note)}</p>
    ${intel ? `<div class="stocks">${stockRows}</div><p class="small muted">Intel from day ${intel.day}${intel.day < s.day - 3 ? ' (stale)' : ''}</p>` : '<p class="small muted">Nobody has been out here. Supplies and danger unknown.</p>'}
    ${hordesHere.map((x) => `<p class="neg small">${ICON.alert} Horde of ~${Math.round(x.size / 5) * 5} here now.</p>`).join('')}
    ${teams.length ? `<p class="small">${teams.length} team${teams.length > 1 ? 's' : ''} assigned here.</p>` : ''}
    <div class="op-buttons">
      ${(['scavenge', 'recon', 'clear', 'intercept'] as OpKind[]).map((k) => `<button class="btn ${k === 'scavenge' ? 'primary' : ''}" data-a="plan" data-kind="${k}" data-id="${id}">${KIND_LABEL[k]}</button>`).join('')}
    </div>
  </section>`;
}

/* --------------------------------------------------------------- planner */

function stepper(label: string, field: string, value: number, max: number, sub = ''): string {
  return `<div class="stepper">
    <div><div>${label}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>
    <div class="step-ctl">
      <button class="sbtn" data-a="pset" data-f="${field}" data-d="-1" ${value <= 0 ? 'disabled' : ''} aria-label="less">−</button>
      <b>${value}</b>
      <button class="sbtn" data-a="pset" data-f="${field}" data-d="1" ${value >= max ? 'disabled' : ''} aria-label="more">+</button>
    </div>
  </div>`;
}

export function plannerSheet(s: GameState, plan: OpPlan): string {
  const l = s.locations[plan.target];
  const err = validatePlan(s, plan);
  const days = planDays(s, plan);
  const path = pathBetween(s, BASE_ID, plan.target);
  const risk = estimateRisk(s, path, plan);
  const fp = opFirepower(plan);
  const capy = haulCapacity(plan);
  const after = s.soldiers - plan.soldiers;
  const garrisonWarn = after < s.garrisonMin;
  const showSite = plan.kind !== 'recon';
  const ret = s.day + days.total;
  return `<div class="sheet-backdrop" data-a="pcancel"></div>
  <div class="sheet" role="dialog" aria-label="Plan operation">
    <div class="sheet-grip"></div>
    <div class="eyebrow">Plan operation</div>
    <h3>${esc(l.name)}</h3>
    <div class="seg">${(['scavenge', 'recon', 'clear', 'intercept'] as OpKind[]).map((k) => `<button class="${plan.kind === k ? 'on' : ''}" data-a="pkind" data-kind="${k}">${KIND_LABEL[k]}</button>`).join('')}</div>
    <p class="small muted">${KIND_HELP[plan.kind]}</p>
    ${stepper('Soldiers', 'soldiers', plan.soldiers, s.soldiers, `${s.soldiers} at base · fight`)}
    ${stepper('Civilians', 'civilians', plan.civilians, plan.kind === 'recon' ? 3 : s.civilians, `${s.civilians} at base · carry & gather`)}
    ${stepper('Trucks', 'trucks', plan.trucks, s.trucks, `${s.trucks} ready · halve travel, carry 60`)}
    ${stepper('Ammo', 'ammo', plan.ammo, s.stock.ammo, 'in steps of 10')}
    ${showSite ? stepper(plan.kind === 'intercept' ? 'Days waiting' : 'Days on site', 'siteDays', plan.siteDays, 4) : ''}
    ${plan.kind === 'scavenge' ? `<div class="prio"><span class="small muted">Priority</span><div class="prio-row">
      <button class="pchip ${plan.priority === 'any' ? 'on' : ''}" data-a="pprio" data-r="any">Any</button>
      ${RESOURCES.map((r) => `<button class="pchip ${plan.priority === r ? 'on' : ''}" data-a="pprio" data-r="${r}" aria-label="${r}">${RES_ICON[r]}</button>`).join('')}
    </div></div>` : ''}
    <div class="summary">
      <div><span>Timeline</span><b>${days.out}d out${showSite ? ` · ${days.site}d ${plan.kind === 'intercept' ? 'waiting' : 'on site'}` : ''} · ${days.out}d back</b></div>
      <div><span>Home by</span><b>Day ${ret}${ret > FINAL_DAY ? ' (after day 30)' : ''}</b></div>
      <div><span>Fuel · Rations</span><b>${planFuel(s, plan)} fuel · ${planRations(s, plan)} food & water</b></div>
      <div><span>Firepower · Carry</span><b>${fp.toFixed(0)} · ${capy}</b></div>
      <div><span>Route risk</span><b class="risk-${risk.toLowerCase()}">${risk}</b></div>
    </div>
    ${garrisonWarn ? `<p class="small warn-text">${ICON.alert} Leaves ${after} soldiers at base, below the Commander's minimum of ${s.garrisonMin}.</p>` : ''}
    ${err ? `<p class="small neg">${esc(err)}</p>` : ''}
    <div class="row gap">
      <button class="btn grow" data-a="pcancel">Cancel</button>
      <button class="btn primary grow" data-a="pgo" ${err ? 'disabled' : ''}>Dispatch</button>
    </div>
  </div>`;
}

/* -------------------------------------------------------------------- ops */

function opStatus(s: GameState, op: Operation): string {
  const where = s.locations[opNode(op)].name;
  if (op.leg === 'out') return `En route · ${op.legLength - op.legDay}d to arrival · near ${where}`;
  if (op.leg === 'site') return `${op.kind === 'intercept' ? 'Dug in' : 'On site'} · day ${op.legDay + 1} of ${op.legLength}`;
  return `Returning · home day ${s.day + op.legLength - op.legDay}`;
}

export function opsView(s: GameState): string {
  const f = fieldPeople(s);
  const list = s.ops.map((op) => {
    const cargo = RESOURCES.filter((r) => op.cargo[r] > 0).map((r) => `<span class="stk">${RES_ICON[r]}${op.cargo[r]}</span>`).join('');
    const wounded = op.woundedSoldiers + op.woundedCivilians;
    return `<section class="card op">
      <div class="row between"><div class="eyebrow">${esc(KIND_LABEL[op.kind])} #${op.id}</div><span class="tag leg-${op.leg}">${op.leg === 'out' ? 'Outbound' : op.leg === 'site' ? 'On site' : 'Inbound'}</span></div>
      <h3>${esc(s.locations[op.target].name)}</h3>
      <p class="small">${esc(opStatus(s, op))}</p>
      <div class="team">
        <span>${ICON.soldier}${op.soldiers}</span><span>${ICON.civ}${op.civilians}</span><span>${ICON.truck}${op.trucks}</span><span>${RES_ICON.ammo}${op.ammo}</span>
        ${wounded ? `<span class="neg">${ICON.heart}${wounded} wounded</span>` : ''}
      </div>
      ${cargo ? `<div class="stocks">${cargo}<span class="muted small">${stockTotal(op.cargo)}/${haulCapacity(op)}</span></div>` : ''}
      ${op.carriesRelay ? `<p class="small pos">${ICON.star} Carrying the relay unit</p>` : ''}
      ${op.leg !== 'back' ? `<button class="btn small-btn" data-a="recall" data-id="${op.id}">Recall</button>` : ''}
    </section>`;
  }).join('');
  return `<section class="card slim"><div class="row between"><div><div class="eyebrow">In the field</div>${s.ops.length} team${s.ops.length === 1 ? '' : 's'} · ${f.soldiers} soldiers · ${f.civilians} civilians</div>
    <button class="btn small-btn" data-a="tab" data-tab="map">New operation</button></div></section>
  ${list || '<p class="muted center small pad">No teams out. Pick a site on the map to plan an operation.</p>'}`;
}

/* ------------------------------------------------------------------- base */

export function baseView(s: GameState): string {
  const f = s.facilities;
  const m = productivity(s);
  const yieldText: Record<Job, string> = {
    farm: `+${(s.jobs.farm * (2 + f.garden) * m).toFixed(0)} food`,
    water: `+${(s.jobs.water * (4 + 2 * f.purifier) * m + 5 * f.purifier).toFixed(0)} water`,
    workshop: `+${(s.jobs.workshop * 0.8 * m).toFixed(1)} parts`,
    build: s.projects.length ? `${(s.jobs.build * m).toFixed(0)} work/day` : 'nothing queued',
    medic: `treat ${s.jobs.medic * (2 + f.infirmary)}/day`,
  };
  const field = fieldPeople(s);
  const pop = population(s);
  const jobs = JOBS.map((j) => `<div class="stepper">
    <div><div>${JOB_LABEL[j][0]}</div><small class="muted">${yieldText[j]}</small></div>
    <div class="step-ctl">
      <button class="sbtn" data-a="job" data-job="${j}" data-d="-1" ${s.jobs[j] <= 0 ? 'disabled' : ''} aria-label="fewer ${JOB_LABEL[j][1]}">−</button>
      <b>${s.jobs[j]}</b>
      <button class="sbtn" data-a="job" data-job="${j}" data-d="1" ${idleCivilians(s) <= 0 ? 'disabled' : ''} aria-label="more ${JOB_LABEL[j][1]}">+</button>
    </div></div>`).join('');

  const projects = s.projects.map((p) => {
    const eta = s.jobs.build > 0 ? `${Math.ceil((p.work - p.workDone) / (s.jobs.build * m))}d` : 'no builders';
    return `<div class="proj"><div class="row between"><span>${esc(FACILITIES[p.facility].name)}${p.level > 1 ? ` L${p.level}` : ''}</span><span class="small ${s.jobs.build ? 'muted' : 'neg'}">${eta}</span></div>${bar(p.workDone, p.work, 'build')}</div>`;
  }).join('');

  const facilities = FACILITY_ORDER.map((id) => {
    const def = FACILITIES[id];
    const lvl = f[id];
    const pending = s.needs.some((n) => n.facility === id);
    const building = s.projects.some((p) => p.facility === id);
    const state = building ? 'Under construction' : pending ? 'Requested' : lvl ? def.effect(lvl) : 'Not needed yet';
    return `<div class="fac ${lvl ? '' : 'dim'}"><div class="row between"><b>${esc(def.name)}</b><span class="lvl">${'■'.repeat(lvl)}${'□'.repeat(def.levels.length - lvl)}</span></div><small class="muted">${esc(state)}</small></div>`;
  }).join('');

  const storage = RESOURCES.map((r) => `<div class="store"><span>${RES_ICON[r]}${RES_LABEL[r]}</span>${bar(s.stock[r], cap(s, r), s.stock[r] >= cap(s, r) * 0.85 ? 'warn' : '')}<small>${n0(s.stock[r])}/${cap(s, r)}</small></div>`).join('');

  return `<section class="card">
    <div class="eyebrow">People · ${pop} total · bunks for ${housing(s)}</div>
    <div class="people">
      <div><b>${s.civilians}</b><small>civilians</small></div>
      <div><b>${s.soldiers}</b><small>soldiers</small></div>
      <div><b class="${injured(s) ? 'neg' : ''}">${injured(s)}</b><small>wounded</small></div>
      <div><b>${field.soldiers + field.civilians}</b><small>in field</small></div>
    </div>
  </section>
  <section class="card">
    <div class="row between"><div class="eyebrow">Work assignments</div><span class="small ${idleCivilians(s) ? 'warn-text' : 'muted'}">${idleCivilians(s)} idle</span></div>
    ${jobs}
    ${m !== 1 ? `<p class="small ${m < 1 ? 'neg' : 'pos'}">Morale is ${m < 1 ? 'dragging output down 25%' : 'lifting output 10%'}.</p>` : ''}
  </section>
  ${projects ? `<section class="card"><div class="eyebrow">Construction queue</div>${projects}</section>` : ''}
  <section class="card"><div class="eyebrow">Facilities</div><p class="small muted">Nothing is built on a whim. Facilities appear when the base asks for them and you approve.</p><div class="facs">${facilities}</div></section>
  <section class="card"><div class="eyebrow">Stores</div>${storage}
    <p class="small muted">${ICON.truck} ${s.trucks} working truck${s.trucks === 1 ? '' : 's'}${s.brokenTrucks ? ` · ${s.brokenTrucks} broken` : ''} · Generator burns 3 fuel/day</p></section>`;
}

/* -------------------------------------------------------------------- log */

function logLines(lines: LogLine[]): string {
  return lines.map((l) => `<li class="tone-${l.tone}">${esc(l.text)}</li>`).join('');
}

export function logView(s: GameState): string {
  const byDay = new Map<number, LogLine[]>();
  for (const l of s.log) {
    if (!byDay.has(l.day)) byDay.set(l.day, []);
    byDay.get(l.day)!.push(l);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0] - a[0]).slice(0, 12);
  return `${days.map(([d, lines]) => `<section class="card slim"><div class="eyebrow">Day ${d}</div><ul class="log">${logLines(lines.filter((l) => !l.text.startsWith('—')))}</ul></section>`).join('')}
  <section class="card slim"><div class="eyebrow">Record</div>
    <p class="small">Directives completed ${s.directivesDone} · failed ${s.directivesFailed} · sieges ${s.sieges} · breaches ${s.breaches} · deaths ${s.deaths}</p>
    <button class="btn" data-a="new">Start a new campaign</button>
  </section>`;
}

/* ----------------------------------------------------------------- modals */

export function reportModal(r: DayReport): string {
  const lines = r.lines.filter((l) => !l.text.startsWith('—'));
  return `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-label="Night report">
    <div class="eyebrow">Night report · day ${r.day}</div>
    <h3>${lines.some((l) => l.tone === 'bad') ? 'A hard night' : lines.some((l) => l.tone === 'warn') ? 'A tense night' : 'A quiet night'}</h3>
    <ul class="log">${logLines(lines) || '<li class="muted">Nothing to report.</li>'}</ul>
    <button class="btn primary wide" data-a="close">Day ${r.day + 1}</button>
  </div>`;
}

export function introModal(s: GameState): string {
  return `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-label="Briefing">
    <div class="eyebrow">Day 1 · ${esc(s.baseName)}</div>
    <h3>You are second in command</h3>
    <p>The Commander sets the goals. You make them possible: who goes where, with what, and what the base spends its parts on.</p>
    <ul class="bullets">
      <li><b>HQ</b>: the Commander's directive, decisions, and requests from the base. Approve them and the base grows. Dismiss them and people remember.</li>
      <li><b>Map</b>: tap a site to send recon, supply runs, clearing teams, or ambushes against hordes.</li>
      <li><b>Base</b>: put civilians to work. Every mouth eats 1 food and drinks 1 water a day.</li>
      <li><b>End day</b>: teams move, hordes move, the night happens.</li>
    </ul>
    <p class="small muted">Keep ${s.garrisonMin} soldiers home, keep the Commander's trust above zero, and get as many people as you can to day ${FINAL_DAY}.</p>
    <button class="btn primary wide" data-a="close">Take the clipboard</button>
  </div>`;
}

export function helpModal(): string {
  return `<div class="modal-backdrop" data-a="close"></div><div class="modal" role="dialog" aria-label="Field manual">
    <div class="eyebrow">Field manual</div>
    <h3>How the base runs</h3>
    <ul class="bullets">
      <li><b>Supplies.</b> Header chips show stock and expected change per day. Field teams pack their own rations when they leave.</li>
      <li><b>Operations.</b> Trucks halve travel time and carry 60 but burn fuel. Unscouted routes show risk as Unknown.</li>
      <li><b>Threat.</b> Every site has a danger level. Scavenging makes noise and raises it. Clearing ops bring it down. Passing hordes raise it again.</li>
      <li><b>Hordes.</b> They spawn at the edge of the map and walk toward the quarry one road per day. A watchtower spots them sooner. Ambush them on the way, or meet them at the walls.</li>
      <li><b>Needs.</b> When the base needs something, someone asks for it. Approving costs parts up front and builder days after. Unanswered requests count as dismissed.</li>
      <li><b>Trust.</b> Completing directives raises it. Failing them, breaking the garrison order, dismissing projects the Commander backs, and losing people all lower it. At zero you are relieved.</li>
      <li><b>Morale.</b> Low morale slows work and makes people leave. Finished projects and full bellies help.</li>
    </ul>
    <button class="btn primary wide" data-a="close">Back to work</button>
  </div>`;
}

export function confirmNewModal(): string {
  return `<div class="modal-backdrop" data-a="close"></div><div class="modal" role="dialog" aria-label="New campaign">
    <h3>Abandon this campaign?</h3>
    <p>The current save will be erased.</p>
    <div class="row gap"><button class="btn grow" data-a="close">Keep playing</button><button class="btn danger grow" data-a="new-yes">Start over</button></div>
  </div>`;
}

export function overModal(s: GameState): string {
  const o = s.over!;
  return `<div class="modal-backdrop"></div><div class="modal over ${o.won ? 'won' : 'lost'}" role="dialog" aria-label="Campaign over">
    <div class="eyebrow">${o.won ? 'Campaign complete' : 'Campaign over'} · day ${s.day}</div>
    <h3>${esc(o.title)}</h3>
    <p>${esc(o.text)}</p>
    <div class="people">
      <div><b>${population(s)}</b><small>alive</small></div>
      <div><b>${s.deaths}</b><small>lost</small></div>
      <div><b>${s.directivesDone}/${DIRECTIVES.length - 1}</b><small>directives</small></div>
      <div><b>${Math.round(s.trust)}</b><small>trust</small></div>
    </div>
    <button class="btn primary wide" data-a="new-yes">New campaign</button>
  </div>`;
}
