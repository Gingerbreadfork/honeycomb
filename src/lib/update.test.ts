import { describe, expect, it } from 'vitest';
import { isNewer } from './update';

describe('isNewer', () => {
  it('compares versions by number, not as text', () => {
    expect(isNewer('0.2.0', '0.1.3')).toBe(true);
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.3', '0.1.3')).toBe(false);
    expect(isNewer('0.1.2', '0.1.3')).toBe(false);
    expect(isNewer('1.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false);
  });
});
