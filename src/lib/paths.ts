/** The last segment of a path, with either kind of separator. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}
