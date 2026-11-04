import { Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { Citation } from '../core/assistant';

type Inline = { kind: 'text' | 'bold'; text: string } | { kind: 'cite'; source: Citation };
type Block = { kind: 'p' | 'ul'; lines: Inline[][]; open?: boolean };

const LIST_ITEM = /^\s*([-*•]|\d+\.)\s+/;

export function parseRichText(text: string, sources: Citation[]): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.trim().split(/\n{2,}/)) {
    // A block may mix a heading line with list items right below it.
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const kind = LIST_ITEM.test(line) ? 'ul' : 'p';
      const parsed = parseInline(kind === 'ul' ? line.replace(LIST_ITEM, '') : line, sources);
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind && last.open) last.lines.push(parsed);
      else blocks.push({ kind, lines: [parsed], open: true });
    }
    const last = blocks[blocks.length - 1];
    if (last) last.open = false;
  }
  return blocks;
}

function parseInline(line: string, sources: Citation[]): Inline[] {
  return line
    .split(/(\*\*[^*]+\*\*|\[\d+\])/g)
    .filter(Boolean)
    .flatMap((part): Inline[] => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return [{ kind: 'bold', text: part.slice(2, -2) }];
      const ref = /^\[(\d+)\]$/.exec(part);
      if (ref) {
        const source = sources.find((s) => s.ref === Number(ref[1]));
        return source ? [{ kind: 'cite', source }] : [];
      }
      return [{ kind: 'text', text: part }];
    });
}

/** Renders the assistant's light markdown with clickable citations. */
@Component({
  selector: 'pc-rich-text',
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    @for (block of blocks(); track $index) {
      @if (block.kind === 'ul') {
        <ul>
          @for (line of block.lines; track $index) {
            <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: line }" /></li>
          }
        </ul>
      } @else {
        <p>
          @for (line of block.lines; track $index) {
            @if (!$first) {
              <br />
            }
            <ng-container *ngTemplateOutlet="inline; context: { $implicit: line }" />
          }
        </p>
      }
    }
    <ng-template #inline let-line>
      @for (part of line; track $index) {
        @switch (part.kind) {
          @case ('bold') {
            <strong>{{ part.text }}</strong>
          }
          @case ('cite') {
            <a class="cite" [routerLink]="['/pacientes', part.source.petId]" [title]="part.source.title">{{
              part.source.ref
            }}</a>
          }
          @default {
            {{ part.text }}
          }
        }
      }
    </ng-template>
  `,
})
export class RichText {
  readonly text = input.required<string>();
  readonly sources = input<Citation[]>([]);
  protected readonly blocks = computed(() => parseRichText(this.text(), this.sources()));
}
