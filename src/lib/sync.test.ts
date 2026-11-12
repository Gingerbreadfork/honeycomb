import { describe, expect, it, vi } from 'vitest';
import type { Reading } from './glucose';

vi.mock('./platform', () => ({ isTauri: false }));

const { toRow } = await import('./sync.svelte');

const reading: Reading = { id: 'a', time: new Date(2026, 8, 15, 8, 0), offset: 0, mmol: 6.4, unit: 'mmol/L', context: '', note: '', updated: 1000, deleted: null };

describe('toRow', () => {
  it('sends stamps the engine can hold', () => {
    expect(toRow({ ...reading, updated: -294544800000, deleted: -5 })).toMatchObject({ updated: 0, deleted: 0 });
    expect(toRow({ ...reading, updated: 1000.4 })).toMatchObject({ updated: 1000, deleted: null });
  });
});
