import type { Lla, Vec3 } from "./types.ts";

/** GRS80 / WGS84 ellipsoid. */
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}
export function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

export function llaToEcef(lla: Lla): Vec3 {
  const lat = deg2rad(lla.lat);
  const lon = deg2rad(lla.lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const h = lla.alt;
  return {
    x: (N + h) * cosLat * cosLon,
    y: (N + h) * cosLat * sinLon,
    z: (N * (1 - WGS84_E2) + h) * sinLat,
  };
}

export function ecefToLla(p: Vec3): Lla {
  const { x, y, z } = p;
  const lon = Math.atan2(y, x);
  const pH = Math.hypot(x, y);
  let lat = Math.atan2(z, pH * (1 - WGS84_E2));
  for (let i = 0; i < 8; i++) {
    const sinLat = Math.sin(lat);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const h = pH / Math.cos(lat) - N;
    const lat2 = Math.atan2(z, pH * (1 - (WGS84_E2 * N) / (N + h)));
    if (Math.abs(lat2 - lat) < 1e-12) {
      lat = lat2;
      return { lat: rad2deg(lat), lon: rad2deg(lon), alt: h };
    }
    lat = lat2;
  }
  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const h = pH / Math.max(1e-12, Math.cos(lat)) - N;
  return { lat: rad2deg(lat), lon: rad2deg(lon), alt: h };
}

export interface EnuFrame {
  originLla: Lla;
  originEcef: Vec3;
  /** Rows are East, North, Up unit vectors in ECEF. */
  E: number[];
}

export function enuFrame(originLla: Lla): EnuFrame {
  const lat = deg2rad(originLla.lat);
  const lon = deg2rad(originLla.lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  // East, North, Up as columns would be; store row-major 3x3.
  const E = [
    -sinLon,
    cosLon,
    0,
    -sinLat * cosLon,
    -sinLat * sinLon,
    cosLat,
    cosLat * cosLon,
    cosLat * sinLon,
    sinLat,
  ];
  return { originLla, originEcef: llaToEcef(originLla), E };
}

function mul3(R: number[], v: Vec3): Vec3 {
  return {
    x: R[0] * v.x + R[1] * v.y + R[2] * v.z,
    y: R[3] * v.x + R[4] * v.y + R[5] * v.z,
    z: R[6] * v.x + R[7] * v.y + R[8] * v.z,
  };
}

export function ecefToEnu(p: Vec3, frame: EnuFrame): Vec3 {
  const d: Vec3 = {
    x: p.x - frame.originEcef.x,
    y: p.y - frame.originEcef.y,
    z: p.z - frame.originEcef.z,
  };
  return mul3(frame.E, d);
}

export function enuToEcef(p: Vec3, frame: EnuFrame): Vec3 {
  // E is orthonormal, transpose = inverse
  const ET = [
    frame.E[0],
    frame.E[3],
    frame.E[6],
    frame.E[1],
    frame.E[4],
    frame.E[7],
    frame.E[2],
    frame.E[5],
    frame.E[8],
  ];
  const w = mul3(ET, p);
  return {
    x: w.x + frame.originEcef.x,
    y: w.y + frame.originEcef.y,
    z: w.z + frame.originEcef.z,
  };
}

export function llaToEnu(lla: Lla, frame: EnuFrame): Vec3 {
  return ecefToEnu(llaToEcef(lla), frame);
}

export function enuToLla(p: Vec3, frame: EnuFrame): Lla {
  return ecefToLla(enuToEcef(p, frame));
}

export function haversineM(a: Lla, b: Lla): number {
  const R = 6371000;
  const dLat = deg2rad(b.lat - a.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface Sim3 {
  s: number;
  R: number[];
  t: Vec3;
}

function centroid(pts: Vec3[]): Vec3 {
  const n = pts.length || 1;
  let x = 0,
    y = 0,
    z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** Kabsch / Umeyama Sim(3) alignment of `src` onto `dst`. Needs ≥3 correspondences. */
export function umeyamaSim3(src: Vec3[], dst: Vec3[]): Sim3 {
  if (src.length !== dst.length || src.length < 3) {
    throw new Error("Sim(3) needs ≥3 matching 3D correspondences");
  }
  const n = src.length;
  const cs = centroid(src);
  const cd = centroid(dst);
  const srcC = src.map((p) => sub(p, cs));
  const dstC = dst.map((p) => sub(p, cd));

  let Sxx = 0,
    Sxy = 0,
    Sxz = 0,
    Syx = 0,
    Syy = 0,
    Syz = 0,
    Szx = 0,
    Szy = 0,
    Szz = 0;
  let varSrc = 0;
  for (let i = 0; i < n; i++) {
    const a = srcC[i];
    const b = dstC[i];
    Sxx += a.x * b.x;
    Sxy += a.x * b.y;
    Sxz += a.x * b.z;
    Syx += a.y * b.x;
    Syy += a.y * b.y;
    Syz += a.y * b.z;
    Szx += a.z * b.x;
    Szy += a.z * b.y;
    Szz += a.z * b.z;
    varSrc += a.x * a.x + a.y * a.y + a.z * a.z;
  }

  // Horn 1987 unit-quaternion rotation (power iteration on the 4×4 N matrix).
  const N = [
    Sxx + Syy + Szz,
    Syz - Szy,
    Szx - Sxz,
    Sxy - Syx,
    Syz - Szy,
    Sxx - Syy - Szz,
    Sxy + Syx,
    Szx + Sxz,
    Szx - Sxz,
    Sxy + Syx,
    -Sxx + Syy - Szz,
    Syz + Szy,
    Sxy - Syx,
    Szx + Sxz,
    Syz + Szy,
    -Sxx - Syy + Szz,
  ];
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 48; it++) {
    const nq = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      nq[r] = N[r * 4] * q[0] + N[r * 4 + 1] * q[1] + N[r * 4 + 2] * q[2] + N[r * 4 + 3] * q[3];
    }
    const nn = Math.hypot(nq[0], nq[1], nq[2], nq[3]) || 1;
    q = nq.map((v) => v / nn);
  }
  const R = quatToR(q);
  let rotatedVar = 0;
  for (let i = 0; i < n; i++) {
    const ra = mul3(R, srcC[i]);
    rotatedVar += ra.x * dstC[i].x + ra.y * dstC[i].y + ra.z * dstC[i].z;
  }
  const s = varSrc > 1e-18 ? rotatedVar / varSrc : 1;
  const Rc = mul3(R, { x: s * cs.x, y: s * cs.y, z: s * cs.z });
  const t = sub(cd, Rc);
  return { s, R, t };
}

function quatToR(q: number[]): number[] {
  const w = q[0],
    x = q[1],
    y = q[2],
    z = q[3];
  const xx = x * x,
    yy = y * y,
    zz = z * z;
  const xy = x * y,
    xz = x * z,
    yz = y * z;
  const wx = w * x,
    wy = w * y,
    wz = w * z;
  return [
    1 - 2 * (yy + zz),
    2 * (xy - wz),
    2 * (xz + wy),
    2 * (xy + wz),
    1 - 2 * (xx + zz),
    2 * (yz - wx),
    2 * (xz - wy),
    2 * (yz + wx),
    1 - 2 * (xx + yy),
  ];
}

export function applySim3(p: Vec3, t: Sim3): Vec3 {
  const r = mul3(t.R, { x: t.s * p.x, y: t.s * p.y, z: t.s * p.z });
  return { x: r.x + t.t.x, y: r.y + t.t.y, z: r.z + t.t.z };
}

export function sim3Rmse(src: Vec3[], dst: Vec3[], t: Sim3): number {
  let acc = 0;
  for (let i = 0; i < src.length; i++) {
    const q = applySim3(src[i], t);
    acc += (q.x - dst[i].x) ** 2 + (q.y - dst[i].y) ** 2 + (q.z - dst[i].z) ** 2;
  }
  return Math.sqrt(acc / src.length);
}

export function matMul3(A: number[], B: number[]): number[] {
  const C = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    }
  }
  return C;
}

export function rotYxzDeg(yaw: number, pitch: number, roll: number): number[] {
  const y = deg2rad(yaw);
  const p = deg2rad(pitch);
  const r = deg2rad(roll);
  const cy = Math.cos(y),
    sy = Math.sin(y);
  const cp = Math.cos(p),
    sp = Math.sin(p);
  const cr = Math.cos(r),
    sr = Math.sin(r);
  // R = Rz(yaw) * Ry(pitch) * Rx(roll)  — aircraft/gimbal approx in ENU
  const Rz = [cy, -sy, 0, sy, cy, 0, 0, 0, 1];
  const Ry = [cp, 0, sp, 0, 1, 0, -sp, 0, cp];
  const Rx = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
  return matMul3(matMul3(Rz, Ry), Rx);
}

/** Camera look-at: world-from-camera, +Z forward in camera, ENU world. */
export function lookAtRotation(eye: Vec3, target: Vec3, up: Vec3 = { x: 0, y: 0, z: 1 }): number[] {
  const f = sub(target, eye);
  const fn = norm(f) || 1;
  const z = { x: f.x / fn, y: f.y / fn, z: f.z / fn };
  let x = cross(z, up);
  const xn = norm(x);
  if (xn < 1e-8) x = cross(z, { x: 1, y: 0, z: 0 });
  const xn2 = norm(x) || 1;
  x = { x: x.x / xn2, y: x.y / xn2, z: x.z / xn2 };
  const y = cross(x, z);
  // columns of R_wc are camera axes in world
  return [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z];
}

export function invertR(R: number[]): number[] {
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}

export function worldToCamera(P: Vec3, C: Vec3, Rwc: number[]): Vec3 {
  const Rcw = invertR(Rwc);
  return mul3(Rcw, sub(P, C));
}

export { mul3 as rotate3, sub as vecSub, dot as vecDot, cross as vecCross, norm as vecNorm };

function svd3(A: number[]): { U: number[]; V: number[]; singular: number[] } {
  // Jacobi SVD for 3x3: compute V from A^T A, then U from AV.
  const AtA = matMul3(transpose3(A), A);
  const { Q: V, diag } = jacobiEigen3(AtA);
  const AV = matMul3(A, V);
  const singular = [
    Math.hypot(AV[0], AV[3], AV[6]),
    Math.hypot(AV[1], AV[4], AV[7]),
    Math.hypot(AV[2], AV[5], AV[8]),
  ];
  const U = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const s = singular[j] > 1e-15 ? 1 / singular[j] : 0;
    U[j] = AV[j] * s;
    U[3 + j] = AV[3 + j] * s;
    U[6 + j] = AV[6 + j] * s;
  }
  // Re-orthogonalize U columns
  orthoColumns(U);
  return { U, V, singular };
}

function transpose3(A: number[]): number[] {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}

function orthoColumns(M: number[]): void {
  const c0 = { x: M[0], y: M[3], z: M[6] };
  const n0 = norm(c0) || 1;
  c0.x /= n0;
  c0.y /= n0;
  c0.z /= n0;
  let c1 = { x: M[1], y: M[4], z: M[7] };
  const p = dot(c1, c0);
  c1 = { x: c1.x - p * c0.x, y: c1.y - p * c0.y, z: c1.z - p * c0.z };
  const n1 = norm(c1) || 1;
  c1.x /= n1;
  c1.y /= n1;
  c1.z /= n1;
  const c2 = cross(c0, c1);
  M[0] = c0.x;
  M[3] = c0.y;
  M[6] = c0.z;
  M[1] = c1.x;
  M[4] = c1.y;
  M[7] = c1.z;
  M[2] = c2.x;
  M[5] = c2.y;
  M[8] = c2.z;
}

function jacobiEigen3(Ain: number[]): { Q: number[]; diag: number[] } {
  const A = Ain.slice();
  let Q = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let iter = 0; iter < 24; iter++) {
    let p = 0,
      q = 1,
      max = Math.abs(A[1]);
    const cand = [
      [0, 2, Math.abs(A[2])],
      [1, 2, Math.abs(A[5])],
    ] as const;
    for (const [i, j, v] of cand) {
      if (v > max) {
        max = v;
        p = i;
        q = j;
      }
    }
    if (max < 1e-15) break;
    const app = A[p * 3 + p];
    const aqq = A[q * 3 + q];
    const apq = A[p * 3 + q];
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.hypot(1, tau));
    const c = 1 / Math.hypot(1, t);
    const s = t * c;
    const R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    R[p * 3 + p] = c;
    R[q * 3 + q] = c;
    R[p * 3 + q] = s;
    R[q * 3 + p] = -s;
    A.splice(0, 9, ...matMul3(matMul3(transpose3(R), A), R));
    Q = matMul3(Q, R);
  }
  return { Q, diag: [A[0], A[4], A[8]] };
}

export function makeIdentitySim3(): Sim3 {
  return { s: 1, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: { x: 0, y: 0, z: 0 } };
}
