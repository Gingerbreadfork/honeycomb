import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reading } from './glucose';

const DATA = '/data/readings.csv';
const files = new Map<string, { text: string; mtime: number }>();
const unreadable = new Set<string>();
let clock = 1000;
const backupFile = vi.fn(async (..._args: unknown[]) => {});

function put(path: string, text: string): void {
  files.set(path, { text, mtime: ++clock });
}

vi.mock('./platform', () => ({
  isTauri: false,
  isMobile: false,
  isDesktop: false,
  appPaths: async () => ({ data_file: DATA, settings_file: '/config/settings.json' }),
  readText: async (path: string) => {
    if (unreadable.has(path)) throw new Error('Permission denied');
    return files.get(path)?.text ?? null;
  },
  writeText: async (path: string, text: string) => {
    put(path, text);
    return clock;
  },
  fileMtime: async (path: string) => files.get(path)?.mtime ?? null,
  backupFile: (...args: unknown[]) => backupFile(...args),
  setBackgroundMode: async () => {},
  quitApp: async () => {},
  pickCsvText: async () => null,
  openLink: async () => {},
  win: { isMaximized: async () => false, onResized: async () => () => {}, close: async () => {} },
}));

const { Store } = await import('./store.svelte');
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
  backupFile.mockClear();
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
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

  it('starts the engine over when another data file is chosen', async () => {
    const { store, push, replace } = await openStore([line('old', 8, '6.4')]);
    put('/elsewhere/other.csv', fileOf([line('other', 9, '8.0')]));
    await store.updateSettings({ dataFile: '/elsewhere/other.csv' });
    expect(store.readings.map((r) => r.id)).toEqual(['other']);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0].map((r) => r.id)).toEqual(['other']);
    expect(push).not.toHaveBeenCalled();
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
