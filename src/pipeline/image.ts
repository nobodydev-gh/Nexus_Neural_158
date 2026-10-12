/** Shared image metrics used by keyframes, masking, and texture scoring. */

export function lumaAt(rgba: Uint8ClampedArray, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

/** Variance of Laplacian — higher is sharper. */
export function laplacianVariance(rgba: Uint8ClampedArray, w: number, h: number, step = 2): number {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const c = lumaAt(rgba, w, x, y);
      const L =
        lumaAt(rgba, w, x, y - 1) +
        lumaAt(rgba, w, x, y + 1) +
        lumaAt(rgba, w, x - 1, y) +
        lumaAt(rgba, w, x + 1, y) -
        4 * c;
      sum += L;
      sum2 += L * L;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export function meanAbsDiff(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  w: number,
  h: number,
  step = 4,
): number {
  let acc = 0;
  let n = 0;
  const len = Math.min(a.length, b.length);
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (i + 2 >= len) continue;
      acc +=
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n++;
    }
  }
  return n ? acc / (3 * n) : 0;
}

export function histogram64(rgba: Uint8ClampedArray, w: number, h: number, step = 4): Float32Array {
  const hist = new Float32Array(64);
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const L = lumaAt(rgba, w, x, y);
      hist[Math.min(63, L >> 2)]++;
      n++;
    }
  }
  if (n) for (let i = 0; i < 64; i++) hist[i] /= n;
  return hist;
}

export function histDiff(a: Float32Array, b: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += Math.abs(a[i] - b[i]);
  return acc * 0.5;
}

export function localVariance(
  rgba: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  rad = 2,
): number {
  let s = 0,
    s2 = 0,
    n = 0;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const L = lumaAt(rgba, w, x + dx, y + dy);
      s += L;
      s2 += L * L;
      n++;
    }
  }
  const mean = s / n;
  return s2 / n - mean * mean;
}

export function sampleBilinear(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number] {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return [-1, -1, -1];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + w * 4;
  const i11 = i01 + 4;
  const r =
    (1 - tx) * (1 - ty) * rgba[i00] +
    tx * (1 - ty) * rgba[i10] +
    (1 - tx) * ty * rgba[i01] +
    tx * ty * rgba[i11];
  const g =
    (1 - tx) * (1 - ty) * rgba[i00 + 1] +
    tx * (1 - ty) * rgba[i10 + 1] +
    (1 - tx) * ty * rgba[i01 + 1] +
    tx * ty * rgba[i11 + 1];
  const b =
    (1 - tx) * (1 - ty) * rgba[i00 + 2] +
    tx * (1 - ty) * rgba[i10 + 2] +
    (1 - tx) * ty * rgba[i01 + 2] +
    tx * ty * rgba[i11 + 2];
  return [r, g, b];
}
