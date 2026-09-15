import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeText as clipWrite } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { readTextFile } from '@tauri-apps/plugin-fs';

export type ResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** Android or iOS build; the desktop build never sets this. */
export const isMobile = isTauri && /Android|iPhone|iPad/i.test(navigator.userAgent);
export const isDesktop = isTauri && !isMobile;

export interface AppPaths {
  data_file: string;
  settings_file: string;
}

const LS_PREFIX = 'honeycomb:file:';

export async function appPaths(): Promise<AppPaths> {
  if (isTauri) return invoke<AppPaths>('app_paths');
  return { data_file: '~/.local/share/honeycomb/readings.csv', settings_file: '~/.config/honeycomb/settings.json' };
}

export async function readText(path: string): Promise<string | null> {
  if (isTauri) return invoke<string | null>('read_text', { path });
  return localStorage.getItem(LS_PREFIX + path);
}

export async function writeText(path: string, text: string): Promise<number | null> {
  if (isTauri) return invoke<number | null>('write_text', { path, text });
  localStorage.setItem(LS_PREFIX + path, text);
  const t = Date.now();
  localStorage.setItem(LS_PREFIX + path + ':mtime', String(t));
  return t;
}

export async function fileMtime(path: string): Promise<number | null> {
  if (isTauri) return invoke<number | null>('file_mtime', { path });
  const v = localStorage.getItem(LS_PREFIX + path + ':mtime');
  return v ? Number(v) : null;
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (!isTauri) return defaultName;
  return saveDialog({ defaultPath: defaultName, filters: [{ name: 'CSV', extensions: ['csv'] }] });
}

export async function pickCsvPath(): Promise<string | null> {
  if (!isTauri) return null;
  const r = await openDialog({ multiple: false, directory: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  return typeof r === 'string' ? r : null;
}

/** Opens a CSV and returns its text. In the browser this uses a file input. */
export async function pickCsvText(): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const path = await pickCsvPath();
    if (!path) return null;
    const text = isMobile ? await readTextFile(path) : await readText(path);
    const name = decodeURIComponent(path.split(/[/%]2F|\//).pop() ?? path).replace(/^.*:/, '') || 'file.csv';
    return text === null ? null : { name, text };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, text: await file.text() });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** In the browser this downloads the file instead of writing to disk. */
export async function exportFile(path: string, text: string): Promise<void> {
  if (isTauri) {
    await invoke('write_text', { path, text });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = path.split('/').pop() ?? 'export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function copyText(text: string): Promise<void> {
  if (isTauri) return clipWrite(text);
  await navigator.clipboard.writeText(text);
}

export async function reveal(path: string): Promise<void> {
  if (isDesktop) await revealItemInDir(path);
}

export async function openLink(url: string): Promise<void> {
  if (isTauri) {
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function setBackgroundMode(on: boolean): Promise<void> {
  if (isTauri) await invoke('set_background_mode', { on });
}

export async function quitApp(): Promise<void> {
  if (isTauri) await invoke('quit_app');
}

export const win = {
  minimize: () => (isDesktop ? getCurrentWindow().minimize() : Promise.resolve()),
  toggleMaximize: () => (isDesktop ? getCurrentWindow().toggleMaximize() : Promise.resolve()),
  close: () => (isDesktop ? getCurrentWindow().close() : Promise.resolve()),
  isMaximized: () => (isDesktop ? getCurrentWindow().isMaximized() : Promise.resolve(false)),
  startDrag: () => (isDesktop ? getCurrentWindow().startDragging() : Promise.resolve()),
  startResize: (dir: ResizeDirection) => (isDesktop ? getCurrentWindow().startResizeDragging(dir as never) : Promise.resolve()),
  onResized: (cb: () => void) => (isDesktop ? getCurrentWindow().onResized(cb) : Promise.resolve(() => {})),
};
