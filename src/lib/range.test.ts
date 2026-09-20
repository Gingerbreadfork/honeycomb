import { describe, expect, it } from 'vitest';
import { RangeState } from './range.svelte';
import type { Reading } from './glucose';

const now = new Date(2026, 8, 15, 12, 0);
const reading = (d: Date): Reading => ({ id: d.getTime().toString(36), time: d, mmol: 6, unit: 'mmol/L', context: '', note: '', updated: 1, deleted: null });
const readings = [reading(new Date(2026, 5, 1, 8)), reading(new Date(2026, 8, 14, 8))];

describe('RangeState', () => {
  it('presets end tomorrow and step back in whole periods', () => {
    const r = new RangeState(30);
    let v = r.resolve(now, readings);
    expect(v.spanDays).toBe(30);
    expect(v.to.getTime()).toBe(new Date(2026, 8, 16).getTime());
    expect(v.from.getTime()).toBe(new Date(2026, 7, 17).getTime());
    expect(v.canForward).toBe(false);
    r.back();
    v = r.resolve(now, readings);
    expect(v.to.getTime()).toBe(new Date(2026, 7, 17).getTime());
    expect(v.from.getTime()).toBe(new Date(2026, 6, 18).getTime());
    expect(v.canForward).toBe(true);
    r.forward();
    expect(r.offset).toBe(0);
  });

  it('stops stepping back before the first reading', () => {
    const r = new RangeState(90);
    r.back();
    r.back();
    const v = r.resolve(now, readings);
    expect(v.canBack).toBe(false);
  });

  it('all covers the first reading to tomorrow', () => {
    const r = new RangeState(0);
    const v = r.resolve(now, readings);
    expect(v.from.getTime()).toBe(new Date(2026, 5, 1).getTime());
    expect(v.canBack).toBe(false);
  });

  it('custom ranges stay between the first reading and today', () => {
    const r = new RangeState(30);
    r.custom = true;
    r.fromText = '0202-01-01';
    r.toText = '2099-01-01';
    const v = r.resolve(now, readings);
    expect(v.from.getTime()).toBe(new Date(2026, 5, 1).getTime());
    expect(v.to.getTime()).toBe(new Date(2026, 8, 16).getTime());
    expect(v.canBack).toBe(false);
    r.fromText = '2026-09-10';
    r.toText = '2026-09-01';
    expect(r.resolve(now, readings).spanDays).toBe(1);
  });

  it('custom ranges shift by their own length', () => {
    const r = new RangeState(30);
    r.setCustom(new Date(2026, 7, 1), new Date(2026, 7, 10));
    let v = r.resolve(now, readings);
    expect(v.spanDays).toBe(10);
    r.back();
    v = r.resolve(now, readings);
    expect(v.from.getTime()).toBe(new Date(2026, 6, 22).getTime());
    r.forward();
    r.forward();
    v = r.resolve(now, readings);
    expect(v.from.getTime()).toBe(new Date(2026, 7, 11).getTime());
  });
});
