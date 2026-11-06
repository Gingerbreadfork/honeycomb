import { parseReadings, readingsToCsv, newId, type ColumnChoice } from './csv';
import { DEFAULT_TARGETS, type Context, type Reading, type Targets, type Unit } from './glucose';
import {
  appPaths,
  backupFile,
  canSelfUpdate,
  fileMtime,
  inFlatpak,
  installUpdate,
  quitApp,
  readText,
  setBackgroundMode,
  writeText,
  win,
  isTauri,
  type AppPaths,
  type UpdateProgress,
} from './platform';
import { SyncState } from './sync.svelte';
import { planImport, type ImportPlan } from './import';
import { mergeSynced } from './merge';
import { dedupeIds, diskKeys, dropExpiredTombstones, reconcileExternal } from './reconcile';
import { pickCsvText } from './platform';
import { dayKey, setHour12, systemHour12 } from './time';
import { isNewer, latestRelease, type Release } from './update';
import { openLink } from './platform';

export type Page = 'log' | 'trends' | 'report';
export type Theme = 'system' | 'light' | 'dark';
export type Clock = 'system' | '12h' | '24h';

/** How often the automatic update check runs while Honeycomb is open. */
const UPDATE_CHECK_EVERY = 12 * 60 * 60 * 1000;
/** How long the automatic check waits after one that failed. */
const UPDATE_RETRY_AFTER = 30 * 60 * 1000;

export interface Settings {
  unit: Unit;
  targets: Targets;
  dataFile: string | null;
  name: string;
  theme: Theme;
  clock: Clock;
  background: boolean;
  checkUpdates: boolean;
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
  checkUpdates: false,
};

/** Names the lines of the data file that could not be read. */
function unreadable(lines: number[]): string {
  if (lines.length === 1) return `Line ${lines[0]} couldn't be read`;
  if (lines.length <= 3) return `Lines ${lines.slice(0, -1).join(', ')} and ${lines.at(-1)} couldn't be read`;
  return `${lines.length} lines couldn't be read, the first on line ${lines[0]}`;
}

/** A backup name of its own, so a copy made now never stands in for the day's first one. */
function backupLabel(d = new Date()): string {
  const clock = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('');
  return `${dayKey(d)}-${clock}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

export class Store {
  settings = $state<Settings>({ ...DEFAULTS });
  rows = $state.raw<Reading[]>([]);
  readings = $derived(this.rows.filter((r) => !r.deleted));
  sync = new SyncState();
  page = $state<Page>('log');
  ready = $state(false);
  startError = $state<string | null>(null);
  loadError = $state<string | null>(null);
  /** Lines of the data file that could not be read, when that is why it was not opened. */
  unreadLines = $state(0);
  toasts = $state<Toast[]>([]);
  settingsOpen = $state(false);
  editing = $state<Reading | null>(null);
  importing = $state<{
    name: string;
    text: string;
    headers: string[];
    choice: ColumnChoice;
    time: number;
    glucose: number;
    plan: ImportPlan;
  } | null>(null);
  maximized = $state(false);
  now = $state(new Date());
  lastSaved = $state<Reading | null>(null);
  /** A release newer than this build, once a check has found one. */
  newRelease = $state<Release | null>(null);
  /** Download progress while a new version is being installed. */
  updating = $state<UpdateProgress | null>(null);
  /** Running inside a Flatpak, so updates arrive through Flatpak and the app does not look for them. */
  flatpak = $state(false);

  paths = $state<AppPaths | null>(null);
  dataPath = $derived(this.settings.dataFile ?? this.paths?.data_file ?? '');

  /** The file `rows` were read from. Saves and reloads use it, so they never reach a file chosen since. */
  private rowsFile = '';
  private failedLoad: 'open' | 'switch' = 'open';
  private fileMtime: number | null = null;
  private lastUpdateCheck = 0;
  private lastUpdateTry = 0;
  private onDisk = new Map<string, string>();
  private backedUp = '';
  private toastSeq = 0;
  private queue: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    try {
      this.paths = await appPaths();
      this.flatpak = await inFlatpak();
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
      void this.checkForUpdateQuietly();
    });
    void setBackgroundMode(this.settings.background);
    this.sync.onRows = (rows) => this.applySynced(rows);
    this.sync.onPulled = (from, changed) => this.toast(`${changed} reading${changed === 1 ? '' : 's'} from ${from}`);
    this.sync.onPaired = (device) => this.toast(`Paired with ${device.name}`);
    this.sync.onPairCancelled = (device) => this.toast(`Pairing with ${device.name} wasn't confirmed on that device`);
    await this.sync.init();
    this.sync.push(this.rows);
    void this.checkForUpdateQuietly();
    setInterval(() => void this.checkForUpdateQuietly(), 60 * 60 * 1000);
  }

  /** Returns true when a newer release exists. Announces it with a toast the first time. */
  async checkForUpdate(): Promise<boolean> {
    const latest = await latestRelease();
    this.lastUpdateCheck = Date.now();
    if (!isNewer(latest.version, __APP_VERSION__)) {
      this.newRelease = null;
      return false;
    }
    if (this.newRelease?.version !== latest.version) {
      const action = canSelfUpdate ? { label: 'Install', run: () => void this.installUpdate() } : { label: 'See it', run: () => void openLink(latest.url) };
      this.toast(`Honeycomb ${latest.version} is out`, action);
    }
    this.newRelease = latest;
    return true;
  }

  /** The automatic check: when turned on, once at startup and then every twelve hours while Honeycomb runs. */
  private async checkForUpdateQuietly(): Promise<void> {
    const now = Date.now();
    if (this.flatpak || !this.settings.checkUpdates || now - this.lastUpdateCheck < UPDATE_CHECK_EVERY || now - this.lastUpdateTry < UPDATE_RETRY_AFTER) return;
    this.lastUpdateTry = now;
    await this.checkForUpdate().catch(() => {});
  }

  /** Fetches the new installer and hands over to it. Points at the release page instead when that is not possible. */
  async installUpdate(): Promise<void> {
    if (this.updating) return;
    const release = this.newRelease;
    const seeIt = release ? { label: 'See it', run: () => void openLink(release.url) } : undefined;
    this.updating = { downloaded: 0, total: null };
    try {
      if (!(await installUpdate((p) => (this.updating = p)))) {
        this.toast("The update isn't ready to install yet. Try again later, or get it from the release page.", seeIt);
      }
    } catch (e) {
      this.toast(`Update failed: ${String(e)}`, seeIt);
    } finally {
      this.updating = null;
    }
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
    try {
      await this.persistSettings();
    } catch (e) {
      this.toast(`Settings could not be saved: ${String(e)}`);
    }
    if (patch.background !== undefined) void setBackgroundMode(this.settings.background);
    if (fileChanged) {
      // Queued, so saves already waiting finish with the old file before the new one is read.
      this.queue = this.queue.then(() => this.loadReadings('switch'));
      await this.queue;
    }
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

  /**
   * 'external' folds a hand-edited file into memory; 'switch' restarts the sync engine from the new file.
   * A file with lines that can't be read is only opened with `keepReadable`, after a backup.
   */
  async loadReadings(mode: 'open' | 'external' | 'switch' = 'open', keepReadable = false): Promise<void> {
    const external = mode === 'external';
    if (!external) {
      this.loadError = null;
      this.unreadLines = 0;
    }
    const path = external ? this.rowsFile : this.dataPath;
    try {
      const text = await readText(path);
      if (external && text === null) {
        // A file that vanished, often only for a moment under a sync tool, is written back instead of emptying the list.
        this.fileMtime = null;
        void this.persist(false);
        return;
      }
      const mtime = await fileMtime(path);
      const parsed = text ? parseReadings(text, this.settings.unit) : null;
      const readings = parsed?.readings ?? [];
      const skipped = parsed?.skippedLines ?? [];
      if (!external && parsed?.headers.length && (parsed.time < 0 || parsed.glucose < 0)) {
        throw new Error("It has no time or glucose column, so it doesn't look like a readings file.");
      }
      if (!external && skipped.length) {
        this.unreadLines = skipped.length;
        if (!keepReadable) throw new Error(`${unreadable(skipped)}.`);
        await backupFile(path, backupLabel(), BACKUPS_KEPT).catch((e) => {
          throw new Error(`It couldn't be backed up first: ${message(e)}`);
        });
        this.unreadLines = 0;
      }
      const unique = dedupeIds(readings);
      const current = dropExpiredTombstones(unique.rows);
      let rows = current.rows;
      let rewrite = unique.changed || current.changed;
      if (external) {
        if (skipped.length) {
          const kept = await backupFile(path, backupLabel(), BACKUPS_KEPT).then(
            () => ' The file as it was is in the backups.',
            () => '',
          );
          this.toast(`${unreadable(skipped)}, so ${skipped.length === 1 ? 'it was' : 'they were'} left out.${kept}`);
        }
        const edit = reconcileExternal(this.rows, rows, this.onDisk, skipped.length === 0);
        rows = edit.rows;
        rewrite = true;
        if (edit.kept) this.toast(`Kept ${edit.kept} reading${edit.kept === 1 ? '' : 's'} missing from the file. Delete them here to remove them everywhere.`);
      }
      this.rows = rows;
      this.rowsFile = path;
      this.fileMtime = mtime;
      this.onDisk = diskKeys(readings);
      if (mode === 'switch') this.sync.replace(rows);
      else if (this.ready) this.sync.push(rows);
      if (rewrite) void this.persist(false);
    } catch (e) {
      if (external) {
        this.toast(`Couldn't reload the file: ${message(e)}`);
        return;
      }
      this.rows = [];
      this.rowsFile = path;
      this.failedLoad = mode;
      this.loadError = message(e);
    }
  }

  /** Reads the file that failed to load again, the same way as before. */
  retryLoad(keepReadable = false): Promise<void> {
    return this.loadReadings(this.failedLoad, keepReadable);
  }

  /** Runs after any queued writes, so the app's own saves are never mistaken for outside edits. */
  private checkExternalChange(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.ready) await this.reloadIfChanged();
    });
    return this.queue;
  }

  /** Folds in the file when something else changed it since the app last read or wrote it. Runs inside the queue. */
  private async reloadIfChanged(): Promise<boolean> {
    if (!this.rowsFile || this.loadError) return false;
    const m = await fileMtime(this.rowsFile);
    if (m === this.fileMtime) return false;
    await this.loadReadings('external');
    if (m !== null) this.toast('Readings reloaded from file');
    return true;
  }

  private persist(push = true): Promise<void> {
    // Rows that never loaded must not be written over the file they are still in.
    if (this.loadError) return this.queue;
    const file = this.rowsFile;
    const snapshot = this.rows;
    if (push) this.sync.push(snapshot);
    this.queue = this.queue.then(async () => {
      try {
        // The reload saves the merged readings itself.
        if (file === this.rowsFile && (await this.reloadIfChanged())) return;
        await this.backupOncePerDay(file);
        const mtime = await writeText(file, readingsToCsv(snapshot));
        if (file !== this.rowsFile) return;
        this.fileMtime = mtime;
        this.onDisk = diskKeys(snapshot);
      } catch (e) {
        this.toast(`Could not save: ${String(e)}`);
      }
    });
    return this.queue;
  }

  private async backupOncePerDay(file: string): Promise<void> {
    const mark = `${file}|${dayKey(new Date())}`;
    if (mark === this.backedUp) return;
    try {
      await backupFile(file, dayKey(new Date()), BACKUPS_KEPT);
      this.backedUp = mark;
    } catch {
      // Saving goes ahead without a backup.
    }
  }

  add(input: ReadingInput): Reading {
    const reading: Reading = { id: newId(), unit: this.settings.unit, updated: Date.now(), deleted: null, offset: -input.time.getTimezoneOffset(), ...input };
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

  previewImport(name: string, text: string, choice: ColumnChoice = {}): void {
    const file = parseReadings(text, this.settings.unit, choice);
    const plan = planImport(this.rows, file.readings, file.skipped);
    this.importing = { name, text, choice, headers: file.headers, time: file.time, glucose: file.glucose, plan };
  }

  /** Reads the file being imported again with columns picked by hand. */
  remapImport(choice: ColumnChoice): void {
    const job = this.importing;
    if (job) this.previewImport(job.name, job.text, { ...job.choice, ...choice });
  }

  confirmImport(): void {
    const job = this.importing;
    if (!job) return;
    this.importing = null;
    // Checked again, since the same readings may have synced in while the dialog was open.
    const { add } = planImport(this.rows, job.plan.add);
    if (!add.length) return;
    this.rows = [...this.rows, ...add].sort((a, b) => a.time.getTime() - b.time.getTime());
    void this.persist();
    const n = add.filter((r) => !r.deleted).length;
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

  /** Resolves once the queue is empty, including saves queued while it waited. */
  private async settle(): Promise<void> {
    let waited: Promise<void>;
    do {
      waited = this.queue;
      await waited.catch(() => {});
    } while (waited !== this.queue);
  }

  /** Both wait for queued saves, so a reading entered just before is not lost. */
  quit(): void {
    if (isTauri) void this.settle().then(() => quitApp());
  }

  closeWindow(): void {
    if (isTauri) void this.settle().then(() => win.close());
  }
}

export const app = new Store();
