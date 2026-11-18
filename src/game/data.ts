import type { FacilityId, GameState, LocationState, Stock } from './types';
import { atBase, cap, housing, injured, population } from './derived';
import { RESOURCES } from './types';

type LocSeed = Omit<LocationState, 'intel' | 'stock' | 'regen'> & {
  stock: Partial<Stock>;
  regen?: Partial<Stock>;
};

const s0 = (p: Partial<Stock>): Stock => ({
  food: 0,
  water: 0,
  fuel: 0,
  ammo: 0,
  meds: 0,
  parts: 0,
  ...p,
});

export const LOCATION_SEEDS: LocSeed[] = [
  {
    id: 'base', name: 'Kestrel Quarry', kind: 'Base', x: 50, y: 72, threat: 0,
    links: ['farm', 'gas', 'market', 'hardware'], stock: {},
    note: 'Our home. Limestone walls on three sides, one road in.',
  },
  {
    id: 'farm', name: 'Pell Farmstead', kind: 'Farm', x: 24, y: 58, threat: 2,
    links: ['base', 'reservoir', 'market'], stock: { food: 150, water: 40, parts: 10 }, regen: { food: 4 },
    note: 'Root cellars and a few untended fields. Food slowly regrows.',
  },
  {
    id: 'gas', name: 'Route 9 Gas & Go', kind: 'Fuel', x: 74, y: 56, threat: 3,
    links: ['base', 'rail', 'hardware'], stock: { fuel: 150, food: 30, parts: 20 },
    note: 'Underground tanks still hold diesel, if you can pump it.',
  },
  {
    id: 'market', name: 'Millbrook Market', kind: 'Grocery', x: 34, y: 92, threat: 4,
    links: ['base', 'farm', 'hospital', 'hardware'], stock: { food: 230, water: 90, meds: 10 },
    note: 'A supermarket in the middle of town. Lots of food, lots of company.',
  },
  {
    id: 'hardware', name: 'Tanner Hardware', kind: 'Materials', x: 70, y: 90, threat: 3,
    links: ['base', 'gas', 'market', 'sheriff'], stock: { parts: 190, fuel: 30 },
    note: 'Lumber, fasteners, wire. Everything a wall needs.',
  },
  {
    id: 'hospital', name: "St. Brigid's Hospital", kind: 'Medical', x: 18, y: 112, threat: 6,
    links: ['market', 'checkpoint'], stock: { meds: 130, food: 20, parts: 20 },
    note: 'The pharmacy was never looted. The wards were never cleared.',
  },
  {
    id: 'sheriff', name: 'County Sheriff', kind: 'Armory', x: 80, y: 116, threat: 6,
    links: ['hardware', 'checkpoint'], stock: { ammo: 260, meds: 10, fuel: 20 },
    note: 'An evidence locker and a gun cage behind a steel door.',
  },
  {
    id: 'reservoir', name: 'Reservoir Pumphouse', kind: 'Water', x: 16, y: 30, threat: 2,
    links: ['farm', 'relay'], stock: { water: 160, parts: 20 }, regen: { water: 20 },
    note: 'Clean water, as much as you can carry. It keeps coming.',
  },
  {
    id: 'rail', name: 'Calder Rail Yard', kind: 'Depot', x: 84, y: 30, threat: 5,
    links: ['gas', 'relay'], stock: { parts: 130, fuel: 90, food: 30 },
    note: 'Stalled freight cars. Some are worth opening.',
  },
  {
    id: 'relay', name: 'Hilltop Relay Station', kind: 'Radio', x: 50, y: 12, threat: 7,
    links: ['reservoir', 'rail'], stock: { parts: 50, fuel: 20 },
    note: 'The regional emergency transmitter. Swarming since the first week.',
  },
  {
    id: 'checkpoint', name: 'Army Checkpoint 4', kind: 'Military', x: 50, y: 132, threat: 8,
    links: ['hospital', 'sheriff'], stock: { ammo: 320, fuel: 110, meds: 40, food: 40 },
    note: 'An overrun roadblock. The trucks are still loaded.',
  },
];

export function makeLocations(): Record<string, LocationState> {
  const out: Record<string, LocationState> = {};
  for (const seed of LOCATION_SEEDS) {
    out[seed.id] = {
      ...seed,
      stock: s0(seed.stock),
      regen: seed.regen ?? {},
      intel: seed.id === 'base' ? { day: 1, threat: 0, stock: s0({}) } : null,
    };
  }
  return out;
}

/** Edge locations where hordes drift in from. */
export const HORDE_SOURCES = ['relay', 'checkpoint', 'rail', 'hospital'];

interface FacilityLevel {
  title: string;
  text: string;
  parts: number;
  work: number;
  backed?: boolean;
  trigger: (s: GameState) => boolean;
}

export interface FacilityDef {
  name: string;
  speaker: string;
  effect: (level: number) => string;
  levels: FacilityLevel[];
}

const nearCap = (s: GameState) => RESOURCES.some((r) => s.stock[r] >= cap(s, r) * 0.85) || s.wasted > 0;

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  infirmary: {
    name: 'Infirmary',
    speaker: 'Dr. Okafor, medic',
    effect: (l) => `Wounded recover ${l === 0 ? 'slowly' : `+${l * 20}% faster`}; each medic treats ${2 + l}`,
    levels: [
      {
        title: 'We are treating wounded on the mess tables',
        text: 'I need a clean room, cots, and a door that closes. Give me that and fewer people die waiting.',
        parts: 25, work: 10,
        trigger: (s) => injured(s) >= 3,
      },
      {
        title: 'The infirmary is overflowing',
        text: 'A second ward and a proper sterilizer. We are losing people we should not lose.',
        parts: 45, work: 18,
        trigger: (s) => injured(s) >= 6 || s.deaths >= 6,
      },
    ],
  },
  garden: {
    name: 'Terrace Gardens',
    speaker: 'Mae Lindqvist, quartermaster clerk',
    effect: (l) => `Each farmer grows ${2 + l} food/day`,
    levels: [
      {
        title: 'The pantry will not last',
        text: 'The old quarry terraces get full sun. Raised beds and irrigation, and the farm crew could feed a lot more of us.',
        parts: 20, work: 12,
        trigger: (s) => s.day >= 3 && s.stock.food < atBase(s) * 5,
      },
      {
        title: 'We need a greenhouse',
        text: 'Cold frames over the terraces. Year-round yield, double the output.',
        parts: 40, work: 18,
        trigger: (s) => s.day >= 10 && s.stock.food < atBase(s) * 4,
      },
    ],
  },
  purifier: {
    name: 'Water Purifier',
    speaker: 'Theo Brandt, engineer',
    effect: (l) => `Each water hauler brings ${4 + 2 * l}/day${l ? `, rain catchment +${5 * l}/day` : ''}`,
    levels: [
      {
        title: 'The quarry pond is undrinkable',
        text: 'Sand filters and a boiler line. Then the pond is a water supply instead of a hazard.',
        parts: 25, work: 10,
        trigger: (s) => s.stock.water < atBase(s) * 3,
      },
      {
        title: 'Catchment tanks on every roof',
        text: 'Gutters, tanks, a second filter bank. We stop hauling water by hand.',
        parts: 35, work: 14,
        trigger: (s) => s.day >= 8 && s.stock.water < atBase(s) * 3,
      },
    ],
  },
  walls: {
    name: 'Perimeter Wall',
    speaker: 'Sgt. Ruiz, garrison',
    effect: (l) => `+${20 * l} base defense`,
    levels: [
      {
        title: 'The open side of the quarry',
        text: 'Three sides are rock. The fourth is a chain fence. A horde will walk right through it.',
        parts: 35, work: 12, backed: true,
        trigger: (s) => s.day >= 4 || s.hordes.some((h) => h.spotted),
      },
      {
        title: 'Reinforce the wall',
        text: 'They hit the wall hard. Concrete footings and a firing step, before the next one.',
        parts: 55, work: 18, backed: true,
        trigger: (s) => s.sieges >= 1,
      },
      {
        title: 'Gatehouse and killing lane',
        text: 'A proper gatehouse. Funnel them into one lane and the garrison does the rest.',
        parts: 70, work: 24,
        trigger: (s) => s.sieges >= 2 || s.breaches >= 1,
      },
    ],
  },
  watchtower: {
    name: 'Watchtower & Radio',
    speaker: 'Pvt. Haddad, lookout',
    effect: (l) => `Hordes spotted ${1 + l} roads out`,
    levels: [
      {
        title: 'We are blind past the gate',
        text: 'A tower on the quarry lip and a scanner. We would see them coming a full day earlier.',
        parts: 30, work: 10, backed: true,
        trigger: (s) => s.day >= 8 || (s.flags.unspotted ?? 0) > 0,
      },
      {
        title: 'Extend the antenna',
        text: 'Rig a directional antenna on the tower. Two more days of warning.',
        parts: 40, work: 14,
        trigger: (s) => s.day >= 16 || (s.flags.unspotted ?? 0) > 1,
      },
    ],
  },
  storage: {
    name: 'Supply Depot',
    speaker: 'Mae Lindqvist, quartermaster clerk',
    effect: (l) => `Storage capacity +${50 * l}%`,
    levels: [
      {
        title: 'We are out of shelf space',
        text: 'Crates are stacked in the rain. Racks, tarps, a dry floor, or we start throwing supplies away.',
        parts: 25, work: 8,
        trigger: nearCap,
      },
      {
        title: 'A second depot shed',
        text: 'The first depot is full again. Same job, twice the size.',
        parts: 45, work: 14,
        trigger: nearCap,
      },
    ],
  },
  bunkhouse: {
    name: 'Bunkhouse',
    speaker: 'Jonah Pike, civilian council',
    effect: (l) => `Housing +${12 * l}`,
    levels: [
      {
        title: 'People are sleeping in the trucks',
        text: 'We are past capacity. Bunks in the old crusher shed would take twelve more.',
        parts: 30, work: 12,
        trigger: (s) => population(s) >= housing(s) - 1,
      },
      {
        title: 'Another bunk block',
        text: 'Crowded again. Every new arrival makes the tempers shorter.',
        parts: 40, work: 14,
        trigger: (s) => population(s) >= housing(s) - 1,
      },
    ],
  },
  armory: {
    name: 'Reloading Bench',
    speaker: 'Sgt. Ruiz, garrison',
    effect: (l) => `Turns up to ${4 * l} parts into ${12 * l} ammo/day`,
    levels: [
      {
        title: 'Brass is piling up',
        text: 'We collect every casing. Give me presses and powder scales and I will turn scrap into rounds.',
        parts: 30, work: 10,
        trigger: (s) => s.day >= 4 && s.stock.ammo < 110,
      },
      {
        title: 'A second press',
        text: 'One press cannot keep up with what we are firing.',
        parts: 40, work: 14,
        trigger: (s) => s.day >= 12 && s.stock.ammo < 120,
      },
    ],
  },
  motorpool: {
    name: 'Motor Pool',
    speaker: 'Theo Brandt, engineer',
    effect: (l) => (l ? 'Trucks burn 2 fuel per road; repairs a broken truck every 3 days (10 parts)' : 'None'),
    levels: [
      {
        title: 'A truck is down',
        text: 'Without a pit, lifts and tools it stays down. Build the motor pool and I can keep the fleet running.',
        parts: 35, work: 12,
        trigger: (s) => s.brokenTrucks > 0,
      },
    ],
  },
  commons: {
    name: 'Commons Hall',
    speaker: 'Jonah Pike, civilian council',
    effect: (l) => (l ? 'Morale +2/day; dampens bad news' : 'None'),
    levels: [
      {
        title: 'People need somewhere that is not a barracks',
        text: 'A hall with a stove where we can eat together and talk. It sounds small. It is not.',
        parts: 25, work: 10,
        trigger: (s) => s.morale < 38,
      },
    ],
  },
};

export const FACILITY_ORDER: FacilityId[] = [
  'walls', 'watchtower', 'infirmary', 'garden', 'purifier', 'storage', 'bunkhouse', 'armory', 'motorpool', 'commons',
];

export interface DirectiveDef {
  title: string;
  text: string;
  issueDay: number;
  window: number;
  check: (s: GameState) => boolean;
  progress: (s: GameState) => string;
  reward: number;
}

const scouted = (s: GameState) => Object.values(s.locations).filter((l) => l.id !== 'base' && l.intel).length;

export const FINAL_DAY = 30;

export const DIRECTIVES: DirectiveDef[] = [
  {
    title: 'Eyes on the valley',
    text: 'I will not plan blind. Get current intel on at least three sites around us.',
    issueDay: 1, window: 4,
    check: (s) => scouted(s) >= 3,
    progress: (s) => `${Math.min(3, scouted(s))}/3 sites scouted`,
    reward: 10,
  },
  {
    title: 'Fill the larder',
    text: 'Winter is coming whether or not the dead are. Hold 200 food in stores at the end of a day.',
    issueDay: 4, window: 6,
    check: (s) => s.stock.food >= 200,
    progress: (s) => `${Math.floor(s.stock.food)}/200 food`,
    reward: 12,
  },
  {
    title: "Take St. Brigid's",
    text: "That pharmacy is the most valuable room in the county. Clear the hospital to threat 2 or less, and I want to see it in your intel report.",
    issueDay: 8, window: 8,
    check: (s) => s.locations.hospital.threat <= 2 && (s.locations.hospital.intel?.threat ?? 99) <= 2,
    progress: (s) => `Reported threat: ${s.locations.hospital.intel ? s.locations.hospital.intel.threat.toFixed(1) : 'unknown'}`,
    reward: 14,
  },
  {
    title: 'Ammunition reserve',
    text: 'Every report says the swarms are getting bigger. Hold 250 rounds in the magazine.',
    issueDay: 13, window: 6,
    check: (s) => s.stock.ammo >= 250,
    progress: (s) => `${Math.floor(s.stock.ammo)}/250 ammo`,
    reward: 12,
  },
  {
    title: 'Bring me the relay',
    text: 'The emergency transmitter at Hilltop is our only way to call for relief. Recover the relay unit and bring it home.',
    issueDay: 18, window: 8,
    check: (s) => s.hasRelay,
    progress: (s) => (s.hasRelay ? 'Relay secured' : s.ops.some((o) => o.carriesRelay) ? 'Relay in transit' : 'Relay still at Hilltop'),
    reward: 18,
  },
  {
    title: 'Hold until relief',
    text: 'Relief columns move at the end of the month. Keep this place standing and at least twenty of our people alive until day 30.',
    issueDay: 23, window: FINAL_DAY - 23,
    check: () => false, // resolved by the victory check
    progress: (s) => `Day ${s.day}/${FINAL_DAY} · ${population(s)} people`,
    reward: 0,
  },
];
