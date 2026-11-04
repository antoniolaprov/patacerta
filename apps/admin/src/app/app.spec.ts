import { dueLabel, whatsapp } from './core/format';
import type { Citation } from './core/assistant';
import { parseRichText } from './shared/rich-text';

const source: Citation = {
  ref: 1,
  sourceType: 'record',
  sourceId: 'r1',
  petId: 'p1',
  petName: 'Thor',
  title: 'Vacina V10',
  date: '01/10/2026',
};

describe('parseRichText', () => {
  it('turns citations into links and keeps bold text', () => {
    const [block] = parseRichText('A **V10** do Thor vence em breve [1].', [source]);
    expect(block.kind).toBe('p');
    expect(block.lines[0]).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'bold', text: 'V10' },
      { kind: 'text', text: ' do Thor vence em breve ' },
      { kind: 'cite', source },
      { kind: 'text', text: '.' },
    ]);
  });

  it('drops citations that do not match a source', () => {
    const [block] = parseRichText('Sem fonte [7]', [source]);
    expect(block.lines[0]).toEqual([{ kind: 'text', text: 'Sem fonte ' }]);
  });

  it('detects lists', () => {
    const blocks = parseRichText('Pendências:\n\n- Vermífugo\n- V10', []);
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ul']);
    expect(blocks[1].lines).toHaveLength(2);
  });
});

describe('format helpers', () => {
  it('builds WhatsApp links for Brazilian numbers', () => {
    expect(whatsapp('(81) 99812-4410', 'Oi')).toBe('https://wa.me/5581998124410?text=Oi');
    expect(whatsapp(null)).toBeNull();
  });

  it('describes due dates', () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 - 3_600_000).toISOString();
    expect(dueLabel(inDays(3))).toBe('vence em 3 dias');
    expect(dueLabel(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('atrasado há 2 dias');
  });
});

describe('parseRichText with headings', () => {
  it('splits a bold heading and the list right below it', () => {
    const blocks = parseRichText('**Pendências**\n- Vermífugo\n- V10\n\nFim.', []);
    expect(blocks.map((b) => [b.kind, b.lines.length])).toEqual([
      ['p', 1],
      ['ul', 2],
      ['p', 1],
    ]);
  });
});
