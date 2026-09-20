const LATEST = 'https://api.github.com/repos/Gingerbreadfork/honeycomb/releases/latest';

export interface Release {
  version: string;
  url: string;
}

function parts(version: string): number[] {
  return version.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Asks GitHub for the newest release. The request carries nothing but the app's address. */
export async function latestRelease(): Promise<Release> {
  const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = (await res.json()) as { tag_name?: string; html_url?: string };
  if (!body.tag_name || !body.html_url) throw new Error('No release found');
  return { version: body.tag_name.replace(/^v/, ''), url: body.html_url };
}
