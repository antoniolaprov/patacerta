import { computeSlots, isoWeekday, parseBusinessHours, withinBusinessHours } from './availability.js';

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

describe('horário de funcionamento', () => {
  const hours = parseBusinessHours('1-5=8-18,6=8-13');

  it('lê dias úteis, sábado e deixa o domingo fechado', () => {
    expect(hours[1]).toEqual([8, 18]);
    expect(hours[5]).toEqual([8, 18]);
    expect(hours[6]).toEqual([8, 13]);
    expect(hours[7]).toBeUndefined();
  });

  it('calcula o dia da semana ISO', () => {
    expect(isoWeekday('2026-11-15')).toBe(7); // domingo
    expect(isoWeekday('2026-11-14')).toBe(6); // sábado
  });

  it('aceita só atendimentos dentro do horário, no fuso da clínica', () => {
    const at = (iso: string, min = 60) => withinBusinessHours(new Date(iso), min, hours, '-03:00');
    expect(at('2026-11-14T12:00:00Z')).toBe(true); // sábado 9h
    expect(at('2026-11-14T15:00:00Z')).toBe(true); // sábado 12h, termina 13h
    expect(at('2026-11-14T15:30:00Z')).toBe(false); // sábado 12h30, passa das 13h
    expect(at('2026-11-15T12:00:00Z')).toBe(false); // domingo
    expect(at('2026-11-16T10:00:00Z')).toBe(false); // segunda 7h
    expect(at('2026-11-16T20:00:00Z')).toBe(true); // segunda 17h
  });
});
