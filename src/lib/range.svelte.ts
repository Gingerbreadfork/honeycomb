import type { Reading } from './glucose';
import { addDays, dateInputValue, fromInputs, startOfDay } from './time';

export interface Resolved {
  from: Date;
  to: Date;
  spanDays: number;
  canForward: boolean;
  canBack: boolean;
}

/** A period selection: a preset length stepped back in whole periods, everything, or explicit dates. */
export class RangeState {
  days = $state(14);
  custom = $state(false);
  offset = $state(0);
  fromText = $state('');
  toText = $state('');

  constructor(days = 14) {
    this.days = days;
  }

  setPreset(days: number): void {
    this.custom = false;
    this.days = days;
    this.offset = 0;
  }

  setCustom(from: Date, to: Date): void {
    this.custom = true;
    this.fromText = dateInputValue(from);
    this.toText = dateInputValue(to);
  }

  back(): void {
    if (this.custom) this.shiftCustom(-1);
    else if (this.days) this.offset += 1;
  }

  forward(): void {
    if (this.custom) this.shiftCustom(1);
    else if (this.days && this.offset > 0) this.offset -= 1;
  }

  private shiftCustom(direction: number): void {
    const from = fromInputs(this.fromText, '00:00');
    const to = fromInputs(this.toText, '00:00');
    if (!from || !to) return;
    const span = Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5) + 1);
    this.fromText = dateInputValue(addDays(from, direction * span));
    this.toText = dateInputValue(addDays(to, direction * span));
  }

  resolve(now: Date, readings: Reading[]): Resolved {
    const today = startOfDay(now);
    if (this.custom) {
      const from = fromInputs(this.fromText, '00:00') ?? addDays(today, -29);
      const toDay = fromInputs(this.toText, '00:00') ?? today;
      const to = addDays(toDay, 1);
      const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5));
      return { from, to, spanDays, canForward: toDay < today, canBack: true };
    }
    if (!this.days) {
      const first = readings[0];
      const from = first ? startOfDay(first.time) : addDays(today, -6);
      const to = addDays(today, 1);
      return { from, to, spanDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5)), canForward: false, canBack: false };
    }
    const to = addDays(today, 1 - this.offset * this.days);
    const from = addDays(to, -this.days);
    const first = readings[0];
    return {
      from,
      to,
      spanDays: this.days,
      canForward: this.offset > 0,
      canBack: !first || from > first.time,
    };
  }
}
