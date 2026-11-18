export const RESOURCES = ['food', 'water', 'fuel', 'ammo', 'meds', 'parts'] as const;
export type Res = (typeof RESOURCES)[number];
export type Stock = Record<Res, number>;

export const JOBS = ['farm', 'water', 'workshop', 'build', 'medic'] as const;
export type Job = (typeof JOBS)[number];

export type FacilityId =
  | 'infirmary'
  | 'garden'
  | 'purifier'
  | 'walls'
  | 'watchtower'
  | 'storage'
  | 'bunkhouse'
  | 'armory'
  | 'motorpool'
  | 'commons';

export interface LocationState {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  links: string[];
  /** True danger level, 0..10. The player only sees `intel`. */
  threat: number;
  stock: Stock;
  regen: Partial<Stock>;
  note: string;
  intel: { day: number; threat: number; stock: Stock } | null;
}

export type OpKind = 'scavenge' | 'recon' | 'clear' | 'intercept';
export type Leg = 'out' | 'site' | 'back';

export interface Operation {
  id: number;
  kind: OpKind;
  target: string;
  path: string[]; // nodes after base, ending at target
  soldiers: number;
  civilians: number;
  trucks: number;
  ammo: number;
  priority: Res | 'any';
  siteDays: number;
  leg: Leg;
  legDay: number; // days elapsed in current leg
  legLength: number;
  cargo: Stock;
  woundedSoldiers: number;
  woundedCivilians: number;
  startDay: number;
  carriesRelay: boolean;
}

export interface Horde {
  id: number;
  size: number;
  at: string;
  spotted: boolean;
  /** day the horde was first spotted, used for the "prepared" defense bonus */
  spottedDay: number | null;
}

export interface Project {
  facility: FacilityId;
  level: number; // level this project will produce
  work: number;
  workDone: number;
}

export interface NeedRequest {
  id: number;
  facility: FacilityId;
  level: number;
  speaker: string;
  title: string;
  text: string;
  parts: number;
  work: number;
  expires: number; // last day to answer
  commanderBacked: boolean;
  repeat: number;
}

export interface ChoiceOption {
  label: string;
  hint?: string;
  effect: string; // key handled by engine
}

export interface Decision {
  id: number;
  title: string;
  text: string;
  options: ChoiceOption[];
  payload: Record<string, number>;
}

export interface DirectiveState {
  index: number;
  issued: number;
  deadline: number;
}

export type LogTone = 'good' | 'bad' | 'info' | 'warn';
export interface LogLine {
  day: number;
  tone: LogTone;
  text: string;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  day: number;
  baseName: string;
  stock: Stock;
  civilians: number; // healthy, at base
  soldiers: number; // healthy, at base
  injuredCivilians: number;
  injuredSoldiers: number;
  trucks: number; // working, at base
  brokenTrucks: number;
  jobs: Record<Job, number>;
  morale: number;
  trust: number;
  facilities: Record<FacilityId, number>;
  projects: Project[];
  needs: NeedRequest[];
  needHistory: Record<string, { last: number; dismissed: number }>;
  decisions: Decision[];
  ops: Operation[];
  hordes: Horde[];
  locations: Record<string, LocationState>;
  directive: DirectiveState | null;
  directivesDone: number;
  directivesFailed: number;
  garrisonMin: number;
  hasRelay: boolean;
  sieges: number;
  breaches: number;
  deaths: number;
  nextId: number;
  nextHordeDay: number;
  wasted: number; // cargo lost to full storage, recent
  flags: Record<string, number>;
  log: LogLine[];
  over: null | { won: boolean; title: string; text: string };
}

export interface DayReport {
  day: number;
  lines: LogLine[];
}
