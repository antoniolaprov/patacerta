import type { ServiceType } from '../db/schema.js';

/** How many pets the clinic can serve at the same time for each kind of service. */
export const CAPACITY: Record<ServiceType, number> = {
  BATH: 2,
  GROOMING: 2,
  CONSULTATION: 1,
  VACCINATION: 1,
  EXAM: 1,
};

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
