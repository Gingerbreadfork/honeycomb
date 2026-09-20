import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGETS, formatValue, gmi, parseInput, statusOf, targetsProblem, toMmol } from './glucose';

describe('glucose', () => {
  it('parses input in either unit and rejects junk', () => {
    expect(parseInput('6,4', 'mmol/L')).toBeCloseTo(6.4);
    expect(parseInput('120', 'mg/dL')).toBeCloseTo(toMmol(120, 'mg/dL'));
    expect(parseInput('0.5', 'mmol/L')).toBeNull();
    expect(parseInput('abc', 'mmol/L')).toBeNull();
    expect(parseInput('', 'mmol/L')).toBeNull();
  });

  it('keeps targets inside the very-low and very-high marks', () => {
    expect(targetsProblem(3.9, 10, 'mmol/L')).toBeNull();
    expect(targetsProblem(54, 250, 'mg/dL')).toBeNull();
    expect(targetsProblem(2.5, 10, 'mmol/L')).toMatch(/low target/);
    expect(targetsProblem(70, 300, 'mg/dL')).toMatch(/high target/);
    expect(targetsProblem(8, 8, 'mmol/L')).toMatch(/above the low/);
    expect(targetsProblem(NaN, 10, 'mmol/L')).toMatch(/numbers/);
  });

  it('classifies against the target range', () => {
    expect(statusOf(2.9, DEFAULT_TARGETS)).toBe('very-low');
    expect(statusOf(3.5, DEFAULT_TARGETS)).toBe('low');
    expect(statusOf(6.4, DEFAULT_TARGETS)).toBe('in-range');
    expect(statusOf(11.2, DEFAULT_TARGETS)).toBe('high');
    expect(statusOf(15, DEFAULT_TARGETS)).toBe('very-high');
  });

  it('formats and estimates A1c', () => {
    expect(formatValue(6.44, 'mmol/L')).toBe('6.4');
    expect(formatValue(6.44, 'mg/dL')).toBe('116');
    expect(gmi(toMmol(154, 'mg/dL'))).toBeCloseTo(7.0, 1);
  });
});
