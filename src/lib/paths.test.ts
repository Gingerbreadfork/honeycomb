import { describe, expect, it } from 'vitest';
import { fileName } from './paths';

describe('fileName', () => {
  it('takes the last segment of a Unix or Windows path', () => {
    expect(fileName('/home/me/.local/share/honeycomb/readings.csv')).toBe('readings.csv');
    expect(fileName('C:\\Users\\me\\AppData\\Roaming\\honeycomb\\readings.csv')).toBe('readings.csv');
    expect(fileName('readings.csv')).toBe('readings.csv');
    expect(fileName('')).toBe('');
  });
});
