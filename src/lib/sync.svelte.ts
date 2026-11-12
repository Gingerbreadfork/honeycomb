import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './platform';
import { normalizeContext, type Reading, type Unit } from './glucose';
import { parseStamp, toLocalIso } from './time';

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface PeerState {
  id: string;
  name: string;
  last_sync: number | null;
  online: boolean;
  syncing: boolean;
  unpaired: boolean;
}

export interface NearbyDevice {
  id: string;
  name: string;
  paired: boolean;
}

export interface SyncSnapshot {
  device: DeviceInfo;
  peers: PeerState[];
  nearby: NearbyDevice[];
  pairing: { code: string; expires: number } | null;
  ready: boolean;
}

export interface PairRequest {
  request_id: number;
  device: DeviceInfo;
  code: string;
}

interface Row {
  id: string;
  time: string;
  mmol: number;
  unit: string;
  context: string;
  note: string;
  updated: number;
  deleted: number | null;
}

/** The engine keeps stamps as whole milliseconds from 1970 on, and turns away a list holding any other. */
const stamp = (ms: number) => Math.max(0, Math.round(ms));

export function toRow(r: Reading): Row {
  return {
    id: r.id,
    time: toLocalIso(r.time, false, r.offset),
    mmol: r.mmol,
    unit: r.unit,
    context: r.context,
    note: r.note,
    updated: stamp(r.updated),
    deleted: r.deleted === null ? null : stamp(r.deleted),
  };
}

function fromRow(row: Row): Reading | null {
  const stamp = parseStamp(row.time);
  if (!stamp || !Number.isFinite(row.mmol)) return null;
  return {
    id: row.id,
    time: stamp.time,
    offset: stamp.offset,
    mmol: row.mmol,
    unit: (row.unit === 'mg/dL' ? 'mg/dL' : 'mmol/L') as Unit,
    context: normalizeContext(row.context ?? ''),
    note: row.note ?? '',
    updated: row.updated,
    deleted: row.deleted ?? null,
  };
}

const MOCK: SyncSnapshot = {
  device: { id: 'local', name: 'This computer' },
  peers: [],
  nearby: [],
  pairing: null,
  ready: true,
};

/** Frontend mirror of the Rust sync engine. */
export class SyncState {
  snapshot = $state<SyncSnapshot | null>(null);
  error = $state<string | null>(null);
  /** Why the engine turned away this device's readings. Null once a list has gone through. */
  pushError = $state<string | null>(null);
  pairRequest = $state<PairRequest | null>(null);
  waitingCode = $state<string | null>(null);
  /** The other device accepted; this one still has to agree the codes matched. */
  pairConfirm = $state<PairRequest | null>(null);
  onRows: ((rows: Reading[]) => void) | null = null;
  onPulled: ((from: string, changed: number) => void) | null = null;
  onPaired: ((device: DeviceInfo) => void) | null = null;
  /** This device said yes, but the user on the other one did not. */
  onPairCancelled: ((device: DeviceInfo) => void) | null = null;
  /** Called when the engine first turns the readings away, not for every list after that. */
  onPushFailed: ((why: string) => void) | null = null;
  private started = false;

  get configured(): boolean {
    return (this.snapshot?.peers.length ?? 0) > 0;
  }

  get busy(): boolean {
    return this.snapshot?.peers.some((p) => p.syncing) ?? false;
  }

  async init(): Promise<void> {
    if (!isTauri) {
      this.snapshot = MOCK;
      return;
    }
    await listen<SyncSnapshot>('sync:state', (e) => (this.snapshot = e.payload));
    await listen<Row[]>('sync:rows', (e) => {
      const readings = e.payload.map(fromRow).filter((r): r is Reading => r !== null);
      this.onRows?.(readings);
    });
    await listen<{ from: string; changed: number }>('sync:pulled', (e) => this.onPulled?.(e.payload.from, e.payload.changed));
    await listen<DeviceInfo>('sync:paired', (e) => this.onPaired?.(e.payload));
    await listen<DeviceInfo>('sync:pair-cancelled', (e) => this.onPairCancelled?.(e.payload));
    await listen<PairRequest>('sync:pair-request', (e) => {
      // The request on screen is never swapped for another under the user's pointer.
      if (this.pairRequest) void invoke('sync_respond_pair', { requestId: e.payload.request_id, accept: false }).catch(() => {});
      else this.pairRequest = e.payload;
    });
    await listen<number>('sync:pair-request-ended', (e) => {
      if (this.pairRequest?.request_id === e.payload) this.pairRequest = null;
    });
    await listen<string>('sync:pair-waiting', (e) => (this.waitingCode = e.payload));
    await listen<PairRequest>('sync:pair-confirm', (e) => (this.pairConfirm = e.payload));
    try {
      this.snapshot = await invoke<SyncSnapshot>('sync_start');
      this.started = true;
    } catch (e) {
      this.error = String(e);
    }
  }

  push(readings: Reading[]): void {
    this.hand('sync_set_rows', readings);
  }

  /** Drops what the engine holds and starts again from these rows. */
  replace(readings: Reading[]): void {
    this.hand('sync_replace_rows', readings);
  }

  /** Gives the engine the readings. Before it has started there is nothing to give them to; the store sends them all once it has. */
  private hand(command: 'sync_set_rows' | 'sync_replace_rows', readings: Reading[]): void {
    if (!isTauri || !this.started) return;
    invoke(command, { rows: readings.map(toRow) }).then(
      () => (this.pushError = null),
      (e) => {
        const first = this.pushError === null;
        this.pushError = String(e);
        if (first) this.onPushFailed?.(this.pushError);
      },
    );
  }

  syncNow(): void {
    if (!isTauri) return;
    void invoke('sync_now').catch(() => {});
  }

  startPairing(): Promise<{ code: string; expires: number }> {
    if (!isTauri) return Promise.resolve({ code: 'demo-code-only-in-browser', expires: Date.now() + 600000 });
    return invoke('sync_start_pairing');
  }

  cancelPairing(): void {
    if (!isTauri) return;
    void invoke('sync_cancel_pairing').catch(() => {});
  }

  pairWith(code: string): Promise<DeviceInfo> {
    return invoke('sync_pair_with', { code });
  }

  async pairNearby(id: string): Promise<DeviceInfo> {
    try {
      return await invoke<DeviceInfo>('sync_pair_nearby', { id });
    } finally {
      this.waitingCode = null;
      this.pairConfirm = null;
    }
  }

  respondPair(requestId: number, accept: boolean): void {
    if (this.pairRequest?.request_id === requestId) this.pairRequest = null;
    if (this.pairConfirm?.request_id === requestId) this.pairConfirm = null;
    if (!isTauri) return;
    void invoke('sync_respond_pair', { requestId, accept }).catch(() => {});
  }

  forget(id: string): Promise<void> {
    return invoke('sync_forget', { id });
  }

  rename(name: string): Promise<void> {
    return invoke('sync_set_device_name', { name });
  }
}
