import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './lib/store.svelte';
import { isTauri } from './lib/platform';
import './styles/app.css';

if (import.meta.env.DEV) {
  (window as unknown as { __honeycomb: unknown }).__honeycomb = app;
  const profilePromise = isTauri ? import('@tauri-apps/api/core').then((m) => m.invoke<string>('app_profile')) : Promise.resolve('browser');
  import.meta.hot?.on('honeycomb:eval', async ({ id, code, profile }: { id: string; code: string; profile: string }) => {
    if ((await profilePromise) !== profile) return;
    try {
      const result = await new Function('app', `return (async () => { ${code} })()`)(app);
      import.meta.hot?.send('honeycomb:result', { id, ok: true, result });
    } catch (e) {
      import.meta.hot?.send('honeycomb:result', { id, ok: false, error: String(e) });
    }
  });
}

mount(App, { target: document.getElementById('app')! });
