import { computeSlots } from './availability.js';

const base = {
  date: '2030-01-10',
  durationMin: 60,
  utcOffset: '-03:00',
  now: new Date('2030-01-01T00:00:00Z'),
};

describe('computeSlots', () => {
  it('offers every half hour between opening and closing', () => {
    const slots = computeSlots({ ...base, capacity: 1, busy: [] });
    // 08:00 .. 17:00 starts for a 60 min service => 19 slots
    expect(slots).toHaveLength(19);
    expect(slots[0].startsAt).toBe('2030-01-10T11:00:00.000Z');
    expect(slots.at(-1)?.endsAt).toBe('2030-01-10T21:00:00.000Z');
  });

  it('removes slots that reached capacity', () => {
    const busy = [
      {
        startsAt: new Date('2030-01-10T11:00:00Z'),
        endsAt: new Date('2030-01-10T12:00:00Z'),
      },
    ];
    const slots = computeSlots({ ...base, capacity: 1, busy });
    const starts = slots.map((s) => s.startsAt);
    expect(starts).not.toContain('2030-01-10T11:00:00.000Z');
    expect(starts).not.toContain('2030-01-10T11:30:00.000Z');
    expect(starts).toContain('2030-01-10T12:00:00.000Z');
  });

  it('keeps partially used slots when capacity allows', () => {
    const busy = [
      {
        startsAt: new Date('2030-01-10T11:00:00Z'),
        endsAt: new Date('2030-01-10T12:00:00Z'),
      },
    ];
    const slots = computeSlots({ ...base, capacity: 2, busy });
    expect(slots[0]).toMatchObject({
      startsAt: '2030-01-10T11:00:00.000Z',
      available: 1,
    });
  });

  it('hides slots in the past', () => {
    const slots = computeSlots({
      ...base,
      capacity: 1,
      busy: [],
      now: new Date('2030-01-10T19:10:00Z'),
    });
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2030-01-10T19:30:00.000Z',
      '2030-01-10T20:00:00.000Z',
    ]);
  });
});
