import { describe, expect, it } from 'vitest';
import { approveNeed, dismissNeed, dispatch, endDay, newGame, recall, validatePlan, type OpPlan } from './engine';
import { population } from './derived';
import { competent, passive, simulate } from './sim';

const scav = (over: Partial<OpPlan> = {}): OpPlan => ({
  kind: 'scavenge', target: 'farm', soldiers: 2, civilians: 3, trucks: 1, ammo: 20, siteDays: 1, priority: 'food', ...over,
});

describe('engine', () => {
  it('is deterministic for a given seed', () => {
    const a = simulate(42, competent);
    const b = simulate(42, competent);
    expect(a).toEqual(b);
  });

  it('starts with a directive and a sane base', () => {
    const s = newGame(1);
    expect(s.directive?.index).toBe(0);
    expect(population(s)).toBe(30);
  });

  it('validates operation plans', () => {
    const s = newGame(1);
    expect(validatePlan(s, scav({ soldiers: 99 }))).toMatch(/soldiers/);
    expect(validatePlan(s, scav({ kind: 'clear', soldiers: 0 }))).toMatch(/soldiers/);
    expect(validatePlan(s, scav({ kind: 'recon', soldiers: 2, civilians: 2 }))).toMatch(/Recon/);
    expect(validatePlan(s, scav({ target: 'base' }))).toMatch(/destination/);
    expect(validatePlan(s, scav())).toBeNull();
  });

  it('moves people and supplies out and back home', () => {
    const s = newGame(7);
    const before = { sol: s.soldiers, civ: s.civilians, trucks: s.trucks, fuel: s.stock.fuel };
    const op = dispatch(s, scav());
    expect(typeof op).not.toBe('string');
    expect(s.soldiers).toBe(before.sol - 2);
    expect(s.trucks).toBe(before.trucks - 1);
    expect(s.stock.fuel).toBe(before.fuel - 6);
    expect(population(s)).toBe(30);
    for (let i = 0; i < 4; i++) endDay(s);
    expect(s.ops).toHaveLength(0);
    expect(s.locations.farm.intel).not.toBeNull();
  });

  it('recalls an operation', () => {
    const s = newGame(3);
    const op = dispatch(s, scav({ target: 'hospital', siteDays: 3 }));
    if (typeof op === 'string') throw new Error(op);
    endDay(s);
    recall(s, op.id);
    expect(s.ops[0]?.leg ?? 'back').toBe('back');
  });

  it('turns approved needs into facilities and penalises dismissals', () => {
    const s = newGame(5);
    s.injuredCivilians = 4;
    s.civilians -= 4;
    s.jobs = { farm: 5, water: 5, workshop: 0, build: 6, medic: 2 };
    s.decisions = [];
    endDay(s);
    const need = s.needs.find((n) => n.facility === 'infirmary');
    expect(need).toBeDefined();
    expect(approveNeed(s, need!.id)).toBeNull();
    for (let i = 0; i < 4 && s.facilities.infirmary === 0; i++) endDay(s);
    expect(s.facilities.infirmary).toBe(1);

    const t = newGame(5);
    t.day = 6;
    endDay(t);
    const wall = t.needs.find((n) => n.facility === 'walls');
    expect(wall?.commanderBacked).toBe(true);
    const trust = t.trust;
    dismissNeed(t, wall!.id);
    expect(t.trust).toBe(trust - 6);
  });

  it('punishes doing nothing and rewards competent play', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => 500 + i * 13);
    const passiveWins = seeds.filter((sd) => simulate(sd, passive).won).length;
    const botWins = seeds.filter((sd) => simulate(sd, competent).won).length;
    expect(passiveWins).toBe(0);
    expect(botWins).toBeGreaterThan(0);
  });
});
