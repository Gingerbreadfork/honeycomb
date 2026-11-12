import { describe, expect, it, vi } from 'vitest';
import type { Reading } from './glucose';
import { beats } from './merge';
import shared from '../../fixtures/merge-order.json';

vi.mock('./platform', () => ({ isTauri: false }));

const { fromRow, toRow } = await import('./sync.svelte');

const reading: Reading = { id: 'a', time: new Date(2026, 8, 15, 8, 0), offset: 0, mmol: 6.4, unit: 'mmol/L', context: '', note: '', updated: 1000, deleted: null };

describe('toRow', () => {
  it('sends stamps the engine can hold', () => {
    expect(toRow({ ...reading, updated: -294544800000, deleted: -5 })).toMatchObject({ updated: 0, deleted: 0 });
    expect(toRow({ ...reading, updated: 1000.4 })).toMatchObject({ updated: 1000, deleted: null });
  });
});

describe('beats', () => {
  // The sync engine runs the same cases against its own `beats`, so the two can't drift apart.
  it.each(shared.cases)('$name', ({ a, b, wins }) => {
    const first = fromRow({ ...shared.base, ...a })!;
    const second = fromRow({ ...shared.base, ...b })!;
    expect(beats(first, second)).toBe(wins === 'a');
    expect(beats(second, first)).toBe(wins === 'b');
  });
});
