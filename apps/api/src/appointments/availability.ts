import type { ServiceType } from '../db/schema.js';

/** How many pets the clinic can serve at the same time for each kind of service. */
export const CAPACITY: Record<ServiceType, number> = {
  BATH: 2,
  GROOMING: 2,
  CONSULTATION: 1,
  VACCINATION: 1,
  EXAM: 1,
};

/** Opening hours by ISO weekday (1 = Monday ... 7 = Sunday); a missing day is closed. */
export type BusinessHours = Record<number, [open: number, close: number]>;

/** Parses "1-5=8-18,6=8-13" (weekday or weekday range = open-close hours). */
export function parseBusinessHours(spec: string): BusinessHours {
  const hours: BusinessHours = {};
  for (const part of spec.split(',')) {
    const m = /^\s*(\d)(?:-(\d))?\s*=\s*(\d{1,2})-(\d{1,2})\s*$/.exec(part);
    if (!m) continue;
    for (let d = Number(m[1]); d <= Number(m[2] ?? m[1]); d++) hours[d] = [Number(m[3]), Number(m[4])];
  }
  return hours;
}

/** ISO weekday of a `YYYY-MM-DD` calendar day. */
export function isoWeekday(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const offsetMs = (utcOffset: string) => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
};

/** True when [start, start + duration] falls inside the clinic's hours on that local day. */
export function withinBusinessHours(start: Date, durationMin: number, hours: BusinessHours, utcOffset: string) {
  const local = new Date(start.getTime() + offsetMs(utcOffset));
  const day = local.toISOString().slice(0, 10);
  const open = hours[isoWeekday(day)];
  if (!open) return false;
  const startMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  return startMin >= open[0] * 60 && startMin + durationMin <= open[1] * 60;
}

export interface BusySlot {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotOptions {
  /** Day in the clinic's local calendar, `YYYY-MM-DD`. */
  date: string;
  durationMin: number;
  capacity: number;
  busy: BusySlot[];
  /** Clinic UTC offset, e.g. `-03:00`. */
  utcOffset: string;
  openHour?: number;
  closeHour?: number;
  stepMin?: number;
  now?: Date;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  available: number;
}

const overlaps = (a: BusySlot, b: BusySlot) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Builds the bookable slots of a day. A slot is offered while the number of
 * overlapping appointments is below the service capacity, it ends before
 * closing time and it hasn't started yet.
 */
export function computeSlots(opts: SlotOptions): Slot[] {
  const {
    date,
    durationMin,
    capacity,
    busy,
    utcOffset,
    openHour = 8,
    closeHour = 18,
    stepMin = 30,
    now = new Date(),
  } = opts;

  const pad = (n: number) => String(n).padStart(2, '0');
  const dayStart = new Date(`${date}T${pad(openHour)}:00:00${utcOffset}`);
  const dayEnd = new Date(`${date}T${pad(closeHour)}:00:00${utcOffset}`);
  if (Number.isNaN(dayStart.getTime())) return [];

  const slots: Slot[] = [];
  for (
    let start = dayStart.getTime();
    start + durationMin * 60_000 <= dayEnd.getTime();
    start += stepMin * 60_000
  ) {
    const candidate = {
      startsAt: new Date(start),
      endsAt: new Date(start + durationMin * 60_000),
    };
    if (candidate.startsAt <= now) continue;
    const used = busy.filter((b) => overlaps(b, candidate)).length;
    const available = capacity - used;
    if (available > 0) {
      slots.push({
        startsAt: candidate.startsAt.toISOString(),
        endsAt: candidate.endsAt.toISOString(),
        available,
      });
    }
  }
  return slots;
}
