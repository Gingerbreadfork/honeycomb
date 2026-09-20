import { parseReadings, readingsToCsv, newId } from './csv';
import { DEFAULT_TARGETS, type Context, type Reading, type Targets, type Unit } from './glucose';
import { appPaths, backupFile, fileMtime, quitApp, readText, setBackgroundMode, writeText, win, isTauri, type AppPaths } from './platform';
import { SyncState } from './sync.svelte';
import { planImport, type ImportPlan } from './import';
import { mergeSynced } from './merge';
import { dedupeIds, reconcileExternal } from './reconcile';
import { pickCsvText } from './platform';
import { dayKey, setHour12, systemHour12 } from './time';

export type Page = 'log' | 'trends' | 'report';
export type Theme = 'system' | 'light' | 'dark';
export type Clock = 'system' | '12h' | '24h';

export interface Settings {
  unit: Unit;
  targets: Targets;
  dataFile: string | null;
  name: string;
  theme: Theme;
  clock: Clock;
  background: boolean;
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export interface ReadingInput {
  time: Date;
  mmol: number;
  context: Context;
  note: string;
}

const BACKUPS_KEPT = 14;

const DEFAULTS: Settings = {
  unit: 'mmol/L',
  targets: { ...DEFAULT_TARGETS },
  dataFile: null,
  name: '',
  theme: 'system',
  clock: 'system',
  background: false,
};

/** A stamp newer than the row's current one, even when this device's clock runs behind. */
function stampAfter(r: Reading): number {
  return Math.max(Date.now(), r.updated + 1);
}

function guessUnit(): Unit {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const region = new Intl.Locale(navigator.language).maximize().region ?? '';
    const mgdl = ['US', 'IN', 'DE', 'AT', 'FR', 'BE', 'IT', 'ES', 'PL', 'JP', 'KR', 'IL', 'MX', 'BR', 'AR', 'CL', 'CO', 'EG', 'TR'];
    if (tz.startsWith('America/') && !tz.includes('Toronto') && !tz.includes('Vancouver')) return 'mg/dL';
    if (tz.startsWith('Australia/') || tz.startsWith('Europe/London') || tz.startsWith('Pacific/Auckland')) return 'mmol/L';
    return mgdl.includes(region) ? 'mg/dL' : 'mmol/L';
  } catch {
    return 'mmol/L';
  }
}

class Store {
  settings = $state<Settings>({ ...DEFAULTS });
  rows = $state.raw<Reading[]>([]);
  readings = $derived(this.rows.filter((r) => !r.deleted));
  sync = new SyncState();
  page = $state<Page>('log');
  ready = $state(false);
  startError = $state<string | null>(null);
  loadError = $state<string | null>(null);
  toasts = $state<Toast[]>([]);
  settingsOpen = $state(false);
  editing = $state<Reading | null>(null);
  importing = $state<{ name: string; plan: ImportPlan } | null>(null);
  maximized = $state(false);
  now = $state(new Date());
  lastSaved = $state<Reading | null>(null);

  paths = $state<AppPaths | null>(null);
  dataPath = $derived(this.settings.dataFile ?? this.paths?.data_file ?? '');

  private fileMtime: number | null = null;
  private writtenIds = new Set<string>();
  private backedUp = '';
  private toastSeq = 0;
  private queue: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    try {
      this.paths = await appPaths();
      await this.loadSettings();
      this.applyTheme();
      this.applyClock();
      await this.loadReadings();
    } catch (e) {
      this.startError = String(e);
      return;
    }
    this.ready = true;
    setInterval(() => (this.now = new Date()), 15_000);
    win.onResized(async () => (this.maximized = await win.isMaximized()));
    this.maximized = await win.isMaximized();
    window.addEventListener('focus', () => {
      void this.checkExternalChange();
      this.sync.syncNow();
    });
    void setBackgroundMode(this.settings.background);
    this.sync.onRows = (rows) => this.applySynced(rows);
    this.sync.onPulled = (from, changed) => this.toast(`${changed} reading${changed === 1 ? '' : 's'} from ${from}`);
    this.sync.onPaired = (device) => this.toast(`Paired with ${device.name}`);
    await this.sync.init();
    this.sync.push(this.rows);
  }

  /** Folds the sync engine's rows into local rows and writes the result to disk. */
  private applySynced(incoming: Reading[]): void {
    const { rows, ahead } = mergeSynced(this.rows, incoming);
    this.rows = rows;
    void this.persist(ahead);
  }

  private async loadSettings(): Promise<void> {
    if (!this.paths) return;
    try {
      const text = await readText(this.paths.settings_file);
      if (text) {
        const parsed = JSON.parse(text) as Partial<Settings>;
        this.settings = { ...DEFAULTS, ...parsed, targets: { ...DEFAULTS.targets, ...(parsed.targets ?? {}) } };
      } else {
        this.settings = { ...DEFAULTS, unit: guessUnit() };
        await this.persistSettings();
      }
    } catch (e) {
      this.settings = { ...DEFAULTS, unit: guessUnit() };
      this.toast(`Settings could not be read: ${String(e)}`);
    }
  }

  private async persistSettings(): Promise<void> {
    if (!this.paths) return;
    await writeText(this.paths.settings_file, JSON.stringify(this.settings, null, 2) + '\n');
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const fileChanged = patch.dataFile !== undefined && patch.dataFile !== this.settings.dataFile;
    this.settings = { ...this.settings, ...patch, targets: { ...this.settings.targets, ...(patch.targets ?? {}) } };
    this.applyTheme();
    this.applyClock();
    await this.persistSettings();
    if (patch.background !== undefined) void setBackgroundMode(this.settings.background);
    if (fileChanged) await this.loadReadings('switch');
  }

  applyTheme(): void {
    const root = document.documentElement;
    if (this.settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = this.settings.theme;
  }

  applyClock(): void {
    const c = this.settings.clock;
    setHour12(c === 'system' ? systemHour12() : c === '12h');
    this.now = new Date();
  }

  /** 'external' folds a hand-edited file into memory; 'switch' restarts the sync engine from the new file. */
  async loadReadings(mode: 'open' | 'external' | 'switch' = 'open'): Promise<void> {
    this.loadError = null;
    try {
      const text = await readText(this.dataPath);
      const mtime = await fileMtime(this.dataPath);
      const parsed = text ? parseReadings(text, this.settings.unit) : { readings: [], skipped: 0 };
      const unique = dedupeIds(parsed.readings);
      let rows = unique.rows;
      let rewrite = unique.changed;
      if (mode === 'external' && text !== null) {
        const edit = reconcileExternal(this.rows, rows, this.writtenIds, parsed.skipped === 0);
        rows = edit.rows;
        rewrite = true;
        if (edit.kept) this.toast(`Kept ${edit.kept} reading${edit.kept === 1 ? '' : 's'} missing from the file. Delete them here to remove them everywhere.`);
      }
      this.rows = rows;
      this.fileMtime = mtime;
      this.writtenIds = new Set(parsed.readings.map((r) => r.id));
      if (mode === 'switch') this.sync.replace(rows);
      else if (this.ready) this.sync.push(rows);
      if (rewrite) void this.persist(false);
    } catch (e) {
      if (mode === 'external') {
        this.toast(`Couldn't reload the file: ${String(e)}`);
        return;
      }
      this.rows = [];
      this.loadError = String(e);
    }
  }

  /** Runs after any queued writes, so the app's own saves are never mistaken for outside edits. */
  private checkExternalChange(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.ready || !this.dataPath) return;
      const m = await fileMtime(this.dataPath);
      if (m === this.fileMtime) return;
      await this.loadReadings('external');
      if (m !== null) this.toast('Readings reloaded from file');
    });
    return this.queue;
  }

  private persist(push = true): Promise<void> {
    // Rows that never loaded must not be written over the file they are still in.
    if (this.loadError) return this.queue;
    const snapshot = this.rows;
    if (push) this.sync.push(snapshot);
    this.queue = this.queue.then(async () => {
      try {
        await this.backupOncePerDay();
        this.fileMtime = await writeText(this.dataPath, readingsToCsv(snapshot));
        this.writtenIds = new Set(snapshot.map((r) => r.id));
      } catch (e) {
        this.toast(`Could not save: ${String(e)}`);
      }
    });
    return this.queue;
  }

  private async backupOncePerDay(): Promise<void> {
    const mark = `${this.dataPath}|${dayKey(new Date())}`;
    if (mark === this.backedUp) return;
    try {
      await backupFile(this.dataPath, dayKey(new Date()), BACKUPS_KEPT);
      this.backedUp = mark;
    } catch {
      // A failed backup must not stop the reading from being saved.
    }
  }

  add(input: ReadingInput): Reading {
    const reading: Reading = { id: newId(), unit: this.settings.unit, updated: Date.now(), deleted: null, ...input };
    this.rows = [...this.rows, reading].sort((a, b) => a.time.getTime() - b.time.getTime());
    this.lastSaved = reading;
    void this.persist();
    return reading;
  }

  update(id: string, patch: Partial<Omit<Reading, 'id' | 'updated'>>): void {
    this.rows = this.rows
      .map((r) => (r.id === id ? { ...r, ...patch, updated: stampAfter(r) } : r))
      .sort((a, b) => a.time.getTime() - b.time.getTime());
    void this.persist();
  }

  remove(id: string): void {
    const removed = this.rows.find((r) => r.id === id);
    if (!removed) return;
    this.rows = this.rows.map((r) => (r.id === id ? { ...r, deleted: Date.now(), updated: stampAfter(r) } : r));
    if (this.lastSaved?.id === id) this.lastSaved = null;
    void this.persist();
    this.toast('Reading deleted', {
      label: 'Undo',
      run: () => {
        this.rows = this.rows.map((r) => (r.id === id ? { ...r, deleted: null, updated: stampAfter(r) } : r));
        void this.persist();
      },
    });
  }

  /** Opens a CSV chooser and shows what an import would add. */
  async chooseImport(): Promise<void> {
    let picked: { name: string; text: string } | null = null;
    try {
      picked = await pickCsvText();
    } catch (e) {
      this.toast(`Couldn't open that file: ${String(e)}`);
      return;
    }
    if (!picked) return;
    this.previewImport(picked.name, picked.text);
  }

  previewImport(name: string, text: string): void {
    const { readings, skipped } = parseReadings(text, this.settings.unit);
    this.importing = { name, plan: planImport(this.rows, readings, skipped) };
  }

  confirmImport(): void {
    const job = this.importing;
    if (!job) return;
    this.importing = null;
    if (!job.plan.add.length) return;
    this.rows = [...this.rows, ...job.plan.add].sort((a, b) => a.time.getTime() - b.time.getTime());
    void this.persist();
    const n = job.plan.add.filter((r) => !r.deleted).length;
    this.toast(`Imported ${n} reading${n === 1 ? '' : 's'}`);
  }

  toast(text: string, action?: Toast['action']): void {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, text, action }];
    setTimeout(() => this.dismissToast(id), action ? 6000 : 3200);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  quit(): void {
    if (isTauri) void quitApp();
  }

  closeWindow(): void {
    if (isTauri) void win.close();
  }
}

export const app = new Store();
