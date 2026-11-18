import './ui/styles.css';
import {
  answerDecision, approveNeed, assignJob, blockingDecisions, clearSave, dismissNeed, dispatch, endDay, load,
  newGame, recall, save, type OpPlan,
} from './game/engine';
import type { GameState, Job, OpKind, Res } from './game/types';
import { ICON } from './ui/icons';
import {
  baseView, confirmNewModal, header, helpModal, hqView, introModal, logView, mapView, opsView, overModal,
  plannerSheet, reportModal, type Tab, type UiState,
} from './ui/views';

const app = document.getElementById('app')!;
let s: GameState = load() ?? newGame();
const ui: UiState = {
  tab: 'hq',
  selected: null,
  plan: null,
  modal: s.day === 1 && s.log.length <= 3 ? { kind: 'intro' } : s.over ? { kind: 'over' } : null,
  flash: null,
};

function defaultPlan(kind: OpKind, target: string): OpPlan {
  const spare = Math.max(0, s.soldiers - s.garrisonMin);
  switch (kind) {
    case 'recon':
      return { kind, target, soldiers: Math.min(1, s.soldiers), civilians: Math.min(1, s.civilians), trucks: 0, ammo: Math.min(10, s.stock.ammo), siteDays: 0, priority: 'any' };
    case 'clear':
      return { kind, target, soldiers: Math.min(spare || s.soldiers, 5), civilians: 0, trucks: 0, ammo: Math.min(60, Math.floor(s.stock.ammo / 10) * 10), siteDays: 2, priority: 'any' };
    case 'intercept':
      return { kind, target, soldiers: Math.min(spare || s.soldiers, 6), civilians: 0, trucks: Math.min(1, s.trucks), ammo: Math.min(60, Math.floor(s.stock.ammo / 10) * 10), siteDays: 2, priority: 'any' };
    default:
      return { kind, target, soldiers: Math.min(2, spare), civilians: Math.min(4, s.civilians), trucks: Math.min(1, s.trucks), ammo: Math.min(20, Math.floor(s.stock.ammo / 10) * 10), siteDays: 2, priority: 'any' };
  }
}

const TABS: [Tab, string, string][] = [
  ['hq', 'HQ', ICON.hq],
  ['map', 'Map', ICON.map],
  ['ops', 'Ops', ICON.ops],
  ['base', 'Base', ICON.base],
  ['log', 'Log', ICON.log],
];

function render(): void {
  const main = app.querySelector('main');
  const scroll = main?.scrollTop ?? 0;
  const prevTab = app.dataset.tab;
  const views: Record<Tab, () => string> = {
    hq: () => hqView(s),
    map: () => mapView(s, ui),
    ops: () => opsView(s),
    base: () => baseView(s),
    log: () => logView(s),
  };
  const pending = blockingDecisions(s);
  const badge: Partial<Record<Tab, number>> = { hq: pending + s.needs.length, ops: s.ops.length };
  let modal = '';
  if (ui.modal?.kind === 'report') modal = reportModal(ui.modal.report);
  else if (ui.modal?.kind === 'intro') modal = introModal(s);
  else if (ui.modal?.kind === 'help') modal = helpModal();
  else if (ui.modal?.kind === 'confirm-new') modal = confirmNewModal();
  else if (ui.modal?.kind === 'over') modal = overModal(s);

  app.innerHTML = `${header(s)}
    <main class="content tab-${ui.tab}">${views[ui.tab]()}</main>
    <div class="dock">
      ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}
      <button class="end-day ${pending ? 'blocked' : ''}" data-a="end">${s.over ? 'Campaign over' : pending ? `Decide first (${pending})` : `End day ${s.day}`}</button>
      <nav class="tabs">${TABS.map(([id, label, icon]) => `<button class="${ui.tab === id ? 'on' : ''}" data-a="tab" data-tab="${id}">${icon}<span>${label}</span>${badge[id] ? `<i>${badge[id]}</i>` : ''}</button>`).join('')}</nav>
    </div>
    ${ui.plan ? plannerSheet(s, ui.plan) : ''}
    ${modal}`;
  app.dataset.tab = ui.tab;
  const nextMain = app.querySelector('main');
  if (nextMain && prevTab === ui.tab) nextMain.scrollTop = scroll;
  ui.flash = null;
}

function commit(): void {
  save(s);
  render();
}

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  switch (d.a) {
    case 'tab':
      ui.tab = d.tab as Tab;
      app.querySelector('main')?.scrollTo(0, 0);
      break;
    case 'help':
      ui.modal = { kind: 'help' };
      break;
    case 'close':
      ui.modal = s.over ? { kind: 'over' } : null;
      break;
    case 'end': {
      if (s.over) {
        ui.modal = { kind: 'over' };
        break;
      }
      if (blockingDecisions(s)) {
        ui.tab = 'hq';
        break;
      }
      const report = endDay(s);
      ui.modal = s.over ? { kind: 'over' } : { kind: 'report', report };
      ui.plan = null;
      break;
    }
    case 'sel':
      ui.selected = d.id === ui.selected ? null : d.id!;
      commit();
      if (ui.selected) app.querySelector('.loc, .content > section.card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    case 'plan':
      ui.plan = defaultPlan(d.kind as OpKind, d.id!);
      break;
    case 'pkind':
      if (ui.plan) ui.plan = defaultPlan(d.kind as OpKind, ui.plan.target);
      break;
    case 'pset':
      if (ui.plan) {
        const f = d.f as 'soldiers' | 'civilians' | 'trucks' | 'ammo' | 'siteDays';
        const step = f === 'ammo' ? 10 : 1;
        const max = { soldiers: s.soldiers, civilians: ui.plan.kind === 'recon' ? 3 : s.civilians, trucks: s.trucks, ammo: s.stock.ammo, siteDays: 4 }[f];
        const min = f === 'siteDays' ? 1 : 0;
        ui.plan[f] = Math.max(min, Math.min(max, ui.plan[f] + Number(d.d) * step));
      }
      break;
    case 'pprio':
      if (ui.plan) ui.plan.priority = d.r as Res | 'any';
      break;
    case 'pcancel':
      ui.plan = null;
      break;
    case 'pgo':
      if (ui.plan) {
        const res = dispatch(s, ui.plan);
        if (typeof res === 'string') ui.flash = res;
        else {
          ui.flash = 'Team dispatched.';
          ui.plan = null;
        }
      }
      break;
    case 'recall':
      recall(s, Number(d.id));
      ui.flash = 'Recall order sent.';
      break;
    case 'need-ok': {
      const err = approveNeed(s, Number(d.id));
      ui.flash = err ?? 'Approved. Assign builders on the Base tab.';
      break;
    }
    case 'need-no':
      dismissNeed(s, Number(d.id));
      break;
    case 'dec':
      answerDecision(s, Number(d.id), Number(d.i));
      break;
    case 'job':
      assignJob(s, d.job as Job, Number(d.d));
      break;
    case 'new':
      ui.modal = { kind: 'confirm-new' };
      break;
    case 'new-yes':
      clearSave();
      s = newGame();
      ui.tab = 'hq';
      ui.selected = null;
      ui.plan = null;
      ui.modal = { kind: 'intro' };
      break;
    default:
      return;
  }
  commit();
});

render();
