import { describe, expect, it } from 'vitest';
import { beats, mergeSynced } from './merge';
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

  it('settles equal stamps the way the sync engine does', () => {
    const localWins = mergeSynced([r('a', 20, 'z')], [r('a', 20, 'a')]);
    expect(localWins.rows[0].note).toBe('z');
    expect(localWins.ahead).toBe(true);
    const engineWins = mergeSynced([r('a', 20, 'a')], [r('a', 20, 'z')]);
    expect(engineWins.rows[0].note).toBe('z');
    expect(engineWins.ahead).toBe(false);
    const deleted = mergeSynced([r('a', 20, 'z')], [{ ...r('a', 20), deleted: 20 }]);
    expect(deleted.rows[0].deleted).toBe(20);
    expect(deleted.ahead).toBe(false);
    const same = mergeSynced([r('a', 20, 'x')], [r('a', 20, 'x')]);
    expect(same.ahead).toBe(false);
  });
});

describe('beats', () => {
  it('compares text by code point like the engine', () => {
    // UTF-16 puts U+FF5E before the surrogate pair of U+1F600; code point and UTF-8 byte order do not.
    expect(beats(r('a', 1, '\u{1F600}'), r('a', 1, '\uFF5E'))).toBe(true);
    expect(beats(r('a', 1, '\uFF5E'), r('a', 1, '\u{1F600}'))).toBe(false);
    expect(beats(r('a', 1, 'ab'), r('a', 1, 'a'))).toBe(true);
  });
});
