import { describe, expect, it } from 'vitest';
import { mergeSynced } from './merge';
import type { Reading } from './glucose';

const r = (id: string, updated: number, note = ''): Reading => ({
  id,
  time: new Date(2026, 8, 15, 8, 0),
  mmol: 6.4,
  unit: 'mmol/L',
  context: '',
  note,
  updated,
  deleted: null,
});

describe('mergeSynced', () => {
  it('keeps a local reading the engine has not seen yet', () => {
    const { rows, ahead } = mergeSynced([r('a', 10), r('just-saved', 50)], [r('a', 10), r('from-phone', 40)]);
    expect(rows.map((x) => x.id).sort()).toEqual(['a', 'from-phone', 'just-saved']);
    expect(ahead).toBe(true);
  });

  it('keeps the newer side of an edited reading', () => {
    const newerLocal = mergeSynced([r('a', 30, 'local')], [r('a', 20, 'remote')]);
    expect(newerLocal.rows[0].note).toBe('local');
    expect(newerLocal.ahead).toBe(true);
    const newerRemote = mergeSynced([r('a', 20, 'local')], [r('a', 30, 'remote')]);
    expect(newerRemote.rows[0].note).toBe('remote');
    expect(newerRemote.ahead).toBe(false);
  });

  it('takes the engine copy when the stamps match', () => {
    const { rows, ahead } = mergeSynced([r('a', 20, 'local')], [r('a', 20, 'engine')]);
    expect(rows[0].note).toBe('engine');
    expect(ahead).toBe(false);
  });
});
