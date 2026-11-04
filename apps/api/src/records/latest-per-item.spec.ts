import { latestPerItem } from './latest-per-item.js';

describe('latestPerItem', () => {
  it('keeps the most recent record of each item per pet', () => {
    const old = { petId: 'thor', title: 'Vacina V10', date: new Date('2025-01-01') };
    const renewed = { petId: 'thor', title: 'vacina v10 ', date: new Date('2026-01-01') };
    const otherPet = { petId: 'mel', title: 'Vacina V10', date: new Date('2024-06-01') };

    const result = latestPerItem([old, renewed, otherPet]);

    expect(result).toHaveLength(2);
    expect(result).toContain(renewed);
    expect(result).toContain(otherPet);
    expect(result).not.toContain(old);
  });
});
