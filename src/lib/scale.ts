export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number]; invert: (p: number) => number };

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const fn = ((v: number) => r0 + (v - d0) * k) as Scale;
  fn.domain = domain;
  fn.range = range;
  fn.invert = (p: number) => (k === 0 ? d0 : d0 + (p - r0) / k);
  return fn;
}

export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

export function ticks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, count);
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Pointy-top hexagon centred on (cx, cy) with circumradius r. */
export function hexPath(cx: number, cy: number, r: number): string {
  const w = r * 0.8660254;
  const h = r / 2;
  return `M${cx} ${cy - r}L${cx + w} ${cy - h}L${cx + w} ${cy + h}L${cx} ${cy + r}L${cx - w} ${cy + h}L${cx - w} ${cy - h}Z`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Smooth path through points using Catmull-Rom converted to cubic beziers. */
export function smoothPath(points: { x: number; y: number }[], tension = 0.35): string {
  if (points.length < 2) return points.length ? `M${points[0].x} ${points[0].y}` : '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
