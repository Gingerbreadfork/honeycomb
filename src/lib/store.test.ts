import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reading } from './glucose';

const DATA = '/data/readings.csv';
const files = new Map<string, { text: string; mtime: number }>();
const unreadable = new Set<string>();
const unwritable = new Set<string>();
let clock = 1000;
let tauri = false;
const backupFile = vi.fn(async (..._args: unknown[]) => {});
const closeWindow = vi.fn(async () => {});
const quitApp = vi.fn(async () => {});

function put(path: string, text: string): void {
  files.set(path, { text, mtime: ++clock });
}

vi.mock('./platform', () => ({
  get isTauri() {
    return tauri;
  },
  isMobile: false,
  isDesktop: false,
  appPaths: async () => ({ data_file: DATA, settings_file: '/config/settings.json' }),
  readText: async (path: string) => {
    if (unreadable.has(path)) throw new Error('Permission denied');
    return files.get(path)?.text ?? null;
  },
  writeText: async (path: string, text: string) => {
    if (unwritable.has(path)) throw new Error('Read-only file system');
    put(path, text);
    return clock;
  },
  fileMtime: async (path: string) => files.get(path)?.mtime ?? null,
  backupFile: (...args: unknown[]) => backupFile(...args),
  setBackgroundMode: async () => {},
  quitApp: () => quitApp(),
  canSelfUpdate: false,
  installUpdate: async () => false,
  pickCsvText: async () => null,
  openLink: async () => {},
  win: { isMaximized: async () => false, onResized: async () => () => {}, close: () => closeWindow() },
}));

const { Store, guessUnit } = await import('./store.svelte');
type StoreInstance = InstanceType<typeof Store>;

/** The parts of the store the page never calls directly: the sync engine and the focus handler drive them. */
interface Internals {
  queue: Promise<void>;
  applySynced(rows: Reading[]): void;
  checkExternalChange(): Promise<void>;
}
const inside = (store: StoreInstance) => store as unknown as Internals;

const HEADER = 'time,glucose,unit,context,note,id,updated,deleted';
const line = (id: string, hour: number, value: string, updated = '2026-09-01T00:00:00.000+00:00') =>
  `2026-09-15T${String(hour).padStart(2, '0')}:00:00+00:00,${value},mmol/L,,,${id},${updated},`;
const fileOf = (lines: string[]) => [HEADER, ...lines].join('\n') + '\n';

async function openStore(lines: string[]) {
  put(DATA, fileOf(lines));
  const store = new Store();
  store.paths = { data_file: DATA, settings_file: '/config/settings.json' };
  await store.loadReadings();
  store.ready = true;
  return { store, push: vi.spyOn(store.sync, 'push'), replace: vi.spyOn(store.sync, 'replace') };
}

const onDisk = () => files.get(DATA)?.text ?? '';
const fromPhone = (id: string, updated: number): Reading => ({
  id,
  time: new Date(2026, 8, 16, 9, 0),
  mmol: 7,
  unit: 'mmol/L',
  context: '',
  note: '',
  updated,
  deleted: null,
});
const typed = { time: new Date(2026, 8, 16, 7, 30), mmol: 5.9, context: '' as const, note: '' };

beforeEach(() => {
  files.clear();
  unreadable.clear();
  unwritable.clear();
  backupFile.mockClear();
  closeWindow.mockReset();
  quitApp.mockClear();
  tauri = false;
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
});

describe('guessUnit', () => {
  it('guesses mmol/L across Canada and mg/dL elsewhere in the Americas', () => {
    for (const tz of ['America/Toronto', 'America/Edmonton', 'America/Halifax', 'America/St_Johns', 'America/Montreal', 'Canada/Pacific']) {
      expect(guessUnit(tz, 'en-US'), tz).toBe('mmol/L');
    }
    expect(guessUnit('America/Chicago', 'en-US')).toBe('mg/dL');
    expect(guessUnit('America/Sao_Paulo', 'pt-BR')).toBe('mg/dL');
    expect(guessUnit('Europe/Berlin', 'de-DE')).toBe('mg/dL');
    expect(guessUnit('Europe/Stockholm', 'sv-SE')).toBe('mmol/L');
  });
});

describe('Store', () => {
  it('keeps a reading saved while a pull was on its way, and sends it back to the engine', async () => {
    const { store, push } = await openStore([line('a', 8, '6.4')]);
    const saved = store.add(typed);
    push.mockClear();
    inside(store).applySynced([...store.rows.filter((r) => r.id === 'a'), fromPhone('from-phone', 5)]);
    await inside(store).queue;
    expect(store.rows.map((r) => r.id).sort()).toEqual(['a', 'from-phone', saved.id].sort());
    expect(onDisk()).toContain(saved.id);
    expect(onDisk()).toContain('from-phone');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('keeps its own edit when an older engine event with the same stamp arrives late', async () => {
    const { store, push } = await openStore([line('a', 8, '6.4', '2099-01-01T00:00:00.000+00:00')]);
    const original = store.rows[0];
    store.update('a', { note: 'z' });
    push.mockClear();
    inside(store).applySynced([{ ...original, note: 'a', updated: original.updated + 1 }]);
    await inside(store).queue;
    expect(store.rows[0].note).toBe('z');
    expect(push).toHaveBeenCalledTimes(1);
    expect(onDisk()).toMatch(/,z,a,/);
  });

  it('does not push again when the pull brought nothing the engine lacks', async () => {
    const { store, push } = await openStore([line('a', 8, '6.4')]);
    inside(store).applySynced([...store.rows, fromPhone('from-phone', 5)]);
    await inside(store).queue;
    expect(push).not.toHaveBeenCalled();
    expect(onDisk()).toContain('from-phone');
  });

  it('turns a hand edit of the file into changes that sync', async () => {
    const { store, push } = await openStore([line('a', 8, '6.4'), line('b', 12, '7.1'), line('c', 18, '5.5')]);
    const before = store.rows.find((r) => r.id === 'b')!.updated;
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, '9.9')]));
    await inside(store).checkExternalChange();
    await inside(store).queue;
    const b = store.rows.find((r) => r.id === 'b')!;
    expect(b.mmol).toBeCloseTo(9.9);
    expect(b.updated).toBeGreaterThan(before);
    expect(store.rows.find((r) => r.id === 'c')?.deleted).not.toBeNull();
    expect(store.readings.map((r) => r.id)).toEqual(['a', 'b']);
    expect(push).toHaveBeenCalled();
    expect(onDisk()).toMatch(/,c,[^,]+,\d{4}-/);
  });

  it('writes the readings back when the file goes missing instead of emptying the list', async () => {
    const { store } = await openStore([line('a', 8, '6.4'), line('b', 12, '7.1')]);
    files.delete(DATA);
    await inside(store).checkExternalChange();
    await inside(store).queue;
    expect(store.readings.map((r) => r.id)).toEqual(['a', 'b']);
    expect(onDisk()).toContain(',a,');
    expect(onDisk()).toContain(',b,');
  });

  it('keeps a hand edit made while the window was hidden when a pull is saved', async () => {
    const { store } = await openStore([line('a', 8, '6.4'), line('b', 12, '7.1')]);
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, '9.9')]));
    inside(store).applySynced([...store.rows, fromPhone('from-phone', 5)]);
    await inside(store).queue;
    await inside(store).queue;
    expect(store.rows.find((r) => r.id === 'b')!.mmol).toBeCloseTo(9.9);
    expect(store.readings.map((r) => r.id).sort()).toEqual(['a', 'b', 'from-phone']);
    expect(onDisk()).toMatch(/,9\.9,mmol\/L,,,b,/);
    expect(onDisk()).toContain('from-phone');
  });

  it('keeps an edit made here when the file changed before it was saved', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, '7.1')]));
    store.update('a', { note: 'edited here' });
    await inside(store).queue;
    await inside(store).queue;
    expect(store.rows.find((r) => r.id === 'a')!.note).toBe('edited here');
    expect(store.readings.map((r) => r.id)).toEqual(['a', 'b']);
    expect(onDisk()).toMatch(/,edited here,a,/);
  });

  it('keeps a deletion that synced in when the file changed before it was saved', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, '7.1')]));
    const a = store.rows[0];
    inside(store).applySynced([{ ...a, deleted: a.updated + 10, updated: a.updated + 10 }]);
    await inside(store).queue;
    await inside(store).queue;
    expect(store.readings.map((r) => r.id)).toEqual(['b']);
    expect(onDisk()).toMatch(/,a,[^,]+,\d{4}-/);
  });

  it('closes the window only after a save the file reload queued', async () => {
    const { store, push } = await openStore([line('a', 8, '6.4')]);
    push.mockImplementation(() => {});
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, '7.1')]));
    const saved = store.add(typed);
    let atClose = '';
    closeWindow.mockImplementation(async () => {
      atClose = onDisk();
    });
    tauri = true;
    store.closeWindow();
    await vi.waitFor(() => expect(closeWindow).toHaveBeenCalled());
    expect(atClose).toContain(saved.id);
    expect(atClose).toContain(',b,');
  });

  it("does not mistake the app's own save for an outside edit", async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    store.add(typed);
    await inside(store).checkExternalChange();
    await inside(store).queue;
    expect(store.toasts.map((t) => t.text)).not.toContain('Readings reloaded from file');
    expect(store.readings).toHaveLength(2);
  });

  it('never saves over a file it could not read', async () => {
    put(DATA, fileOf([line('a', 8, '6.4')]));
    const original = onDisk();
    unreadable.add(DATA);
    const store = new Store();
    store.paths = { data_file: DATA, settings_file: '/config/settings.json' };
    await store.loadReadings();
    expect(store.loadError).toMatch(/Permission denied/);
    store.add(typed);
    await inside(store).queue;
    expect(onDisk()).toBe(original);

    unreadable.clear();
    await store.loadReadings();
    expect(store.loadError).toBeNull();
    expect(store.readings.map((r) => r.id)).toEqual(['a']);
  });

  it('says the readings are not saved while a changed file cannot be read, and saves once it can', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, '7.1')]));
    const edited = onDisk();
    unreadable.add(DATA);
    const saved = store.add(typed);
    await inside(store).queue;
    expect(onDisk()).toBe(edited);
    expect(store.saveProblem).toMatch(/Permission denied/);
    expect(store.toasts.map((t) => t.text)).not.toContain('Readings reloaded from file');

    unreadable.clear();
    await store.retrySave();
    await inside(store).queue;
    expect(store.saveProblem).toBeNull();
    expect(store.readings.map((r) => r.id).sort()).toEqual(['a', 'b', saved.id].sort());
    expect(onDisk()).toContain(saved.id);
    expect(onDisk()).toContain(',b,');
  });

  it('keeps a save that failed in mind and writes it when the window comes back', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    unwritable.add(DATA);
    const saved = store.add(typed);
    await inside(store).queue;
    expect(store.saveProblem).toMatch(/Read-only file system/);
    expect(onDisk()).not.toContain(saved.id);

    unwritable.clear();
    await inside(store).checkExternalChange();
    await inside(store).queue;
    expect(store.saveProblem).toBeNull();
    expect(onDisk()).toContain(saved.id);
  });

  it('asks before quitting while a save has not gone through', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    tauri = true;
    unwritable.add(DATA);
    store.add(typed);
    store.quit();
    await vi.waitFor(() => expect(store.leaving).not.toBeNull());
    expect(quitApp).not.toHaveBeenCalled();
    store.leaving!();
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('quits by itself once the save that held it up goes through', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    tauri = true;
    unwritable.add(DATA);
    const saved = store.add(typed);
    store.quit();
    await vi.waitFor(() => expect(store.leaving).not.toBeNull());
    unwritable.clear();
    await store.retrySave();
    expect(onDisk()).toContain(saved.id);
    expect(store.leaving).toBeNull();
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('hides the window without asking when the app keeps running behind it', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    tauri = true;
    store.settings = { ...store.settings, background: true };
    unwritable.add(DATA);
    store.add(typed);
    store.closeWindow();
    await vi.waitFor(() => expect(closeWindow).toHaveBeenCalled());
    expect(store.leaving).toBeNull();
  });

  it('leaves a file with lines it cannot read alone until told to open it without them', async () => {
    put(DATA, fileOf([line('a', 8, '6.4'), line('needs-repair', 9, 'typo')]));
    const original = onDisk();
    const store = new Store();
    store.paths = { data_file: DATA, settings_file: '/config/settings.json' };
    await store.loadReadings();
    store.ready = true;
    expect(store.loadError).toBe("Line 3 couldn't be read.");
    expect(store.unreadLines).toBe(1);
    put(DATA, original);
    await inside(store).checkExternalChange();
    store.add(typed);
    await inside(store).queue;
    expect(onDisk()).toBe(original);
    expect(store.loadError).not.toBeNull();

    await store.retryLoad(true);
    expect(store.loadError).toBeNull();
    expect(store.unreadLines).toBe(0);
    expect(backupFile).toHaveBeenCalledWith(DATA, expect.stringMatching(/^\d{4}-\d{2}-\d{2}-\d{6}$/), 14);
    expect(store.readings.map((r) => r.id)).toEqual(['a']);
  });

  it('will not open a file without time and glucose columns', async () => {
    put(DATA, 'name,email\nAnn,ann@example.com\n');
    const store = new Store();
    store.paths = { data_file: DATA, settings_file: '/config/settings.json' };
    await store.loadReadings();
    expect(store.loadError).toMatch(/doesn't look like a readings file/);
    expect(store.unreadLines).toBe(0);
  });

  it('backs up a hand-edited file before leaving out a line it cannot read', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    put(DATA, fileOf([line('a', 8, '6.4'), line('b', 12, 'typo')]));
    let backedUp = '';
    backupFile.mockImplementationOnce(async () => {
      backedUp = onDisk();
    });
    await inside(store).checkExternalChange();
    await inside(store).queue;
    expect(backedUp).toContain('typo');
    expect(store.toasts.map((t) => t.text)).toContain("Line 3 couldn't be read, so it was left out. The file as it was is in the backups.");
    expect(store.readings.map((r) => r.id)).toEqual(['a']);
  });

  it('tries a file that failed to load after a switch the same way again', async () => {
    const { store, replace } = await openStore([line('old', 8, '6.4')]);
    const other = '/elsewhere/other.csv';
    put(other, fileOf([line('other', 9, '8.0'), line('bad', 10, 'typo')]));
    await store.updateSettings({ dataFile: other });
    expect(store.loadError).toBe("Line 3 couldn't be read.");
    await store.retryLoad(true);
    expect(store.readings.map((r) => r.id)).toEqual(['other']);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('starts the engine over when another data file is chosen', async () => {
    const { store, push, replace } = await openStore([line('old', 8, '6.4')]);
    put('/elsewhere/other.csv', fileOf([line('other', 9, '8.0')]));
    await store.updateSettings({ dataFile: '/elsewhere/other.csv' });
    expect(store.readings.map((r) => r.id)).toEqual(['other']);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0].map((r) => r.id)).toEqual(['other']);
    expect(push).not.toHaveBeenCalled();
  });

  it('writes a save still waiting when another file is chosen into the file it came from', async () => {
    const { store } = await openStore([line('old', 8, '6.4')]);
    const other = '/elsewhere/other.csv';
    put(other, fileOf([line('other', 9, '8.0')]));
    const saved = store.add(typed);
    await store.updateSettings({ dataFile: other });
    await inside(store).queue;
    expect(store.readings.map((r) => r.id)).toEqual(['other']);
    expect(files.get(other)?.text).not.toContain(saved.id);
    expect(onDisk()).toContain(saved.id);
  });

  it('switches to the chosen file even when the settings cannot be saved', async () => {
    const { store } = await openStore([line('old', 8, '6.4')]);
    const other = '/elsewhere/other.csv';
    put(other, fileOf([line('other', 9, '8.0')]));
    unwritable.add('/config/settings.json');
    await store.updateSettings({ dataFile: other });
    expect(store.readings.map((r) => r.id)).toEqual(['other']);
    expect(store.toasts.map((t) => t.text)).toContain('Settings could not be saved: Error: Read-only file system');
    store.add(typed);
    await inside(store).queue;
    expect(onDisk()).not.toContain('other');
  });

  it('does not import a reading twice when it synced in while the dialog was open', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    store.previewImport('meter.csv', fileOf([line('m1', 10, '5.0'), line('m2', 11, '5.5')]));
    const m1 = store.importing!.plan.add.find((r) => r.id === 'm1')!;
    inside(store).applySynced([...store.rows, m1]);
    store.confirmImport();
    await inside(store).queue;
    expect(store.rows.map((r) => r.id).sort()).toEqual(['a', 'm1', 'm2']);
    expect(store.toasts.map((t) => t.text)).toContain('Imported 1 reading');
  });

  it('brings a deleted reading back from a backup only when asked to', async () => {
    const { store } = await openStore([line('a', 8, '6.4'), line('b', 12, '7.1')]);
    const backup = onDisk();
    store.remove('b');
    const tombstone = store.rows.find((r) => r.id === 'b')!;

    store.previewImport('readings-backup.csv', backup);
    expect(store.importing!.plan.deleted.map((r) => r.id)).toEqual(['b']);
    store.confirmImport();
    expect(store.readings.map((r) => r.id)).toEqual(['a']);

    store.previewImport('readings-backup.csv', backup);
    store.confirmImport(true);
    await inside(store).queue;
    const b = store.rows.find((r) => r.id === 'b')!;
    expect(b.deleted).toBeNull();
    expect(b.updated).toBeGreaterThan(tombstone.updated);
    expect(store.readings.map((r) => r.id)).toEqual(['a', 'b']);
    expect(store.toasts.map((t) => t.text)).toContain('Imported 1 reading');
    expect(onDisk()).toMatch(/,7\.1,mmol\/L,,,b,[^,]+,\n/);
  });

  it('backs the file up once a day, before the first write', async () => {
    const { store } = await openStore([line('a', 8, '6.4')]);
    store.add(typed);
    store.add({ ...typed, time: new Date(2026, 8, 16, 12, 30) });
    await inside(store).queue;
    expect(backupFile).toHaveBeenCalledTimes(1);
    expect(backupFile.mock.calls[0][0]).toBe(DATA);
  });

  it('stamps an edit later than the row was, even when this clock is behind', async () => {
    const { store } = await openStore([line('a', 8, '6.4', '2099-01-01T00:00:00.000+00:00')]);
    const before = store.rows[0].updated;
    store.update('a', { note: 'edited' });
    expect(store.rows[0].updated).toBe(before + 1);
  });

  it('keeps a toast up while it is held, and for a moment after', () => {
    vi.useFakeTimers();
    try {
      const store = new Store();
      store.toast('Saved');
      store.toast('Reading deleted', { label: 'Undo', run: () => {} });
      const undo = store.toasts[1].id;
      vi.advanceTimersByTime(5000);
      expect(store.toasts.map((t) => t.text)).toEqual(['Reading deleted']);
      store.holdToast(undo);
      vi.advanceTimersByTime(60_000);
      expect(store.toasts).toHaveLength(1);
      store.resumeToast(undo);
      vi.advanceTimersByTime(1400);
      expect(store.toasts).toHaveLength(1);
      vi.advanceTimersByTime(200);
      expect(store.toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets deletions past their keep time when the file is opened', async () => {
    const old = '2020-01-01T00:00:00.000+00:00';
    put(DATA, fileOf([line('a', 8, '6.4'), `2020-01-01T08:00:00+00:00,6.0,mmol/L,,,ancient,${old},${old}`]));
    const store = new Store();
    store.paths = { data_file: DATA, settings_file: '/config/settings.json' };
    await store.loadReadings();
    await inside(store).queue;
    expect(store.rows.map((r) => r.id)).toEqual(['a']);
    expect(onDisk()).not.toContain('ancient');
  });
});
