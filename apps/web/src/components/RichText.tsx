import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Citation } from '../lib/chat';

/**
 * Renders the small subset of markdown the assistant uses (paragraphs, lists,
 * **bold**) and turns citations like [2] into links to the pet's history.
 */
const LIST_ITEM = /^\s*([-*•]|\d+\.)\s+/;

type Block = { kind: 'p' | 'ul'; lines: string[] };

/** Splits text into paragraphs and lists; a list may follow a heading line directly. */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.trim().split(/\n{2,}/)) {
    let current: Block | null = null;
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const kind = LIST_ITEM.test(line) ? 'ul' : 'p';
      const content = kind === 'ul' ? line.replace(LIST_ITEM, '') : line;
      if (current && current.kind === kind) current.lines.push(content);
      else blocks.push((current = { kind, lines: [content] }));
    }
  }
  return blocks;
}

export function RichText({ text, sources = [] }: { text: string; sources?: Citation[] }) {
  return (
    <>
      {toBlocks(text).map((block, i) =>
        block.kind === 'ul' ? (
          <ul key={i}>
            {block.lines.map((l, j) => (
              <li key={j}>{inline(l, sources)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, sources)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </>
  );
}

function inline(text: string, sources: Citation[]): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const ref = /^\[(\d+)\]$/.exec(part);
    if (ref) {
      const source = sources.find((s) => s.ref === Number(ref[1]));
      if (!source) return null;
      return (
        <Link
          key={i}
          className="cite"
          to={`/pets/${source.petId}#${source.sourceId}`}
          title={`${source.title}${source.date ? `, ${source.date}` : ''}`}
        >
          {source.ref}
        </Link>
      );
    }
    return part;
  });
}
