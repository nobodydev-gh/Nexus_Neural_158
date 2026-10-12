import type { CameraIntrinsics, CameraPose, FrameBuffer, Vec3 } from "./types.ts";
import { invertR, vecSub } from "./coords.ts";
import { lumaAt } from "./image.ts";

export interface Keypoint {
  x: number;
  y: number;
  score: number;
  desc: Uint8Array;
}

const BRIEF_PAIRS: [number, number, number, number][] = (() => {
  const pairs: [number, number, number, number][] = [];
  let s = 123456789;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s / 0xffffffff) * 2 - 1) * 12;
  };
  for (let i = 0; i < 128; i++) pairs.push([rnd(), rnd(), rnd(), rnd()]);
  return pairs;
})();

/** FAST-9 corners + 128-bit BRIEF. */
export function detectFast(frame: FrameBuffer, maxKeep = 400, stride = 2): Keypoint[] {
  const { rgba, width: w, height: h } = frame;
  const thresh = 18;
  const pts: Keypoint[] = [];
  const ring = [
    [0, -3],
    [1, -3],
    [2, -2],
    [3, -1],
    [3, 0],
    [3, 1],
    [2, 2],
    [1, 3],
    [0, 3],
    [-1, 3],
    [-2, 2],
    [-3, 1],
    [-3, 0],
    [-3, -1],
    [-2, -2],
    [-1, -3],
  ];
  for (let y = 4; y < h - 4; y += stride) {
    for (let x = 4; x < w - 4; x += stride) {
      const p = lumaAt(rgba, w, x, y);
      let brighter = 0;
      let darker = 0;
      // quick test: 0, 4, 8, 12
      for (const k of [0, 4, 8, 12]) {
        const v = lumaAt(rgba, w, x + ring[k][0], y + ring[k][1]);
        if (v > p + thresh) brighter++;
        else if (v < p - thresh) darker++;
      }
      if (brighter < 3 && darker < 3) continue;
      let runB = 0,
        runD = 0,
        maxB = 0,
        maxD = 0;
      for (let i = 0; i < 24; i++) {
        const [dx, dy] = ring[i % 16];
        const v = lumaAt(rgba, w, x + dx, y + dy);
        if (v > p + thresh) {
          runB++;
          runD = 0;
        } else if (v < p - thresh) {
          runD++;
          runB = 0;
        } else {
          runB = 0;
          runD = 0;
        }
        if (runB > maxB) maxB = runB;
        if (runD > maxD) maxD = runD;
      }
      if (maxB >= 9 || maxD >= 9) {
        const score = Math.max(maxB, maxD);
        pts.push({ x, y, score, desc: briefAt(rgba, w, h, x, y) });
      }
    }
  }
  pts.sort((a, b) => b.score - a.score);
  return nms(pts, 6).slice(0, maxKeep);
}

function briefAt(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number): Uint8Array {
  const desc = new Uint8Array(16);
  for (let i = 0; i < 128; i++) {
    const [ax, ay, bx, by] = BRIEF_PAIRS[i];
    const xa = clamp(Math.round(x + ax), 1, w - 2);
    const ya = clamp(Math.round(y + ay), 1, h - 2);
    const xb = clamp(Math.round(x + bx), 1, w - 2);
    const yb = clamp(Math.round(y + by), 1, h - 2);
    const bit = lumaAt(rgba, w, xa, ya) < lumaAt(rgba, w, xb, yb) ? 1 : 0;
    desc[i >> 3] |= bit << (i & 7);
  }
  return desc;
}

function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

function nms(pts: Keypoint[], r: number): Keypoint[] {
  const keep: Keypoint[] = [];
  for (const p of pts) {
    if (keep.some((q) => Math.abs(q.x - p.x) <= r && Math.abs(q.y - p.y) <= r)) continue;
    keep.push(p);
  }
  return keep;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export interface Match {
  i: number;
  j: number;
  dist: number;
}

export function matchBrief(a: Keypoint[], b: Keypoint[], ratio = 0.78, maxDist = 28): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i < a.length; i++) {
    let best = 999,
      bestJ = -1,
      second = 999;
    for (let j = 0; j < b.length; j++) {
      const d = hamming(a[i].desc, b[j].desc);
      if (d < best) {
        second = best;
        best = d;
        bestJ = j;
      } else if (d < second) second = d;
    }
    if (bestJ >= 0 && best <= maxDist && best <= ratio * second) {
      matches.push({ i, j: bestJ, dist: best });
    }
  }
  // unique j
  matches.sort((x, y) => x.dist - y.dist);
  const used = new Set<number>();
  const uniq: Match[] = [];
  for (const m of matches) {
    if (used.has(m.j)) continue;
    used.add(m.j);
    uniq.push(m);
  }
  return uniq;
}

export function projectPoint(
  P: Vec3,
  pose: CameraPose,
  K: CameraIntrinsics,
): { u: number; v: number; z: number } | null {
  const Rcw = invertR(pose.R);
  const d = vecSub(P, pose.C);
  const x = Rcw[0] * d.x + Rcw[1] * d.y + Rcw[2] * d.z;
  const y = Rcw[3] * d.x + Rcw[4] * d.y + Rcw[5] * d.z;
  const z = Rcw[6] * d.x + Rcw[7] * d.y + Rcw[8] * d.z;
  if (z <= 0.2) return null;
  const u = K.fx * (x / z) + K.cx;
  const v = K.fy * (y / z) + K.cy;
  if (u < -20 || v < -20 || u > K.width + 20 || v > K.height + 20) return null;
  return { u, v, z };
}

/** Linear triangulation from two known poses. */
export function triangulate(
  u1: number,
  v1: number,
  u2: number,
  v2: number,
  p1: CameraPose,
  p2: CameraPose,
  K: CameraIntrinsics,
): Vec3 | null {
  const ray = (u: number, v: number, pose: CameraPose): { o: Vec3; d: Vec3 } => {
    const xn = (u - K.cx) / K.fx;
    const yn = (v - K.cy) / K.fy;
    // camera +Z forward, R is world-from-camera
    const d = {
      x: pose.R[0] * xn + pose.R[1] * yn + pose.R[2],
      y: pose.R[3] * xn + pose.R[4] * yn + pose.R[5],
      z: pose.R[6] * xn + pose.R[7] * yn + pose.R[8],
    };
    const n = Math.hypot(d.x, d.y, d.z) || 1;
    return { o: pose.C, d: { x: d.x / n, y: d.y / n, z: d.z / n } };
  };
  const A = ray(u1, v1, p1);
  const B = ray(u2, v2, p2);
  const w0 = vecSub(A.o, B.o);
  const a = A.d.x * A.d.x + A.d.y * A.d.y + A.d.z * A.d.z;
  const b = A.d.x * B.d.x + A.d.y * B.d.y + A.d.z * B.d.z;
  const c = B.d.x * B.d.x + B.d.y * B.d.y + B.d.z * B.d.z;
  const d = A.d.x * w0.x + A.d.y * w0.y + A.d.z * w0.z;
  const e = B.d.x * w0.x + B.d.y * w0.y + B.d.z * w0.z;
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-10) return null;
  const t = (b * e - c * d) / denom;
  const s = (a * e - b * d) / denom;
  if (t < 0.3 || s < 0.3) return null;
  const pA = { x: A.o.x + A.d.x * t, y: A.o.y + A.d.y * t, z: A.o.z + A.d.z * t };
  const pB = { x: B.o.x + B.d.x * s, y: B.o.y + B.d.y * s, z: B.o.z + B.d.z * s };
  const mid = { x: 0.5 * (pA.x + pB.x), y: 0.5 * (pA.y + pB.y), z: 0.5 * (pA.z + pB.z) };
  const midLen = Math.hypot(pA.x - pB.x, pA.y - pB.y, pA.z - pB.z);
  if (midLen > 8) return null;
  return mid;
}

export function reprojectionError(
  P: Vec3,
  pose: CameraPose,
  K: CameraIntrinsics,
  u: number,
  v: number,
): number {
  const pr = projectPoint(P, pose, K);
  if (!pr) return 1e3;
  return Math.hypot(pr.u - u, pr.v - v);
}
