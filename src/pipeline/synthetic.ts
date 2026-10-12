import type {
  CameraIntrinsics,
  CameraPose,
  FrameBuffer,
  Lla,
  PointRecord,
  ProcessingMode,
  TelemetrySample,
} from "./types.ts";
import { lookAtRotation } from "./coords.ts";
import { laplacianVariance as lapVar } from "./image.ts";

export interface SyntheticWorld {
  origin: Lla;
  building: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number };
  gtPoints: { x: number; y: number; z: number }[];
  knownWidthM: number;
  knownLengthM: number;
  knownHeightM: number;
}

export function makeWorld(): SyntheticWorld {
  const origin: Lla = { lat: 28.6139, lon: 77.209, alt: 216 };
  const building = { cx: 8, cy: 4, cz: 3.5, sx: 16, sy: 10, sz: 7 };
  const gtPoints: { x: number; y: number; z: number }[] = [];
  for (let x = -24; x <= 40; x += 2) {
    for (let y = -18; y <= 22; y += 2) {
      gtPoints.push({ x, y, z: terrainZ(x, y) });
    }
  }
  for (const [sx, sy, sz] of sampleBox(building)) gtPoints.push({ x: sx, y: sy, z: sz });
  return {
    origin,
    building,
    gtPoints,
    knownWidthM: building.sx,
    knownLengthM: building.sy,
    knownHeightM: building.sz,
  };
}

function terrainZ(x: number, y: number): number {
  return 0.35 * Math.sin(x * 0.12) * Math.cos(y * 0.15) + 0.08 * Math.sin(x * 0.4 + y * 0.2);
}

function sampleBox(b: SyntheticWorld["building"]): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const hx = b.sx / 2,
    hy = b.sy / 2;
  for (let u = -hx; u <= hx; u += 1.2) {
    for (let v = 0; v <= b.sz; v += 1.2) {
      pts.push([b.cx + u, b.cy - hy, b.cz - b.sz / 2 + v]);
      pts.push([b.cx + u, b.cy + hy, b.cz - b.sz / 2 + v]);
    }
  }
  for (let u = -hy; u <= hy; u += 1.2) {
    for (let v = 0; v <= b.sz; v += 1.2) {
      pts.push([b.cx - hx, b.cy + u, b.cz - b.sz / 2 + v]);
      pts.push([b.cx + hx, b.cy + u, b.cz - b.sz / 2 + v]);
    }
  }
  for (let u = -hx; u <= hx; u += 1.2) {
    for (let v = -hy; v <= hy; v += 1.2) {
      pts.push([b.cx + u, b.cy + v, b.cz + b.sz / 2]);
    }
  }
  return pts;
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

type Hit = { z: number; r: number; g: number; b: number; kind: "sky" | "ground" | "road" | "bldg" };

function shade(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: Hit["kind"]): Hit {
  const sun = Math.max(0.18, nx * 0.35 + ny * 0.15 + nz * 0.75);
  let r = 90,
    g = 110,
    b = 80;
  if (kind === "ground") {
    const n = hash(x * 3.1, y * 3.3);
    r = 72 + n * 40;
    g = 98 + n * 50;
    b = 58 + n * 20;
  } else if (kind === "road") {
    const mark = Math.abs(y - 12) < 0.18 && x % 4 < 2 ? 1 : 0;
    r = g = b = mark ? 210 : 48 + hash(x, y) * 20;
  } else if (kind === "bldg") {
    const u = x;
    const v = z;
    const win = Math.abs(((u + 20) % 3) - 1.2) < 0.55 && ((v + 20) % 2.4) > 0.7 && ((v + 20) % 2.4) < 2.05;
    const brick = hash(Math.floor(u * 2), Math.floor(v * 2));
    r = win ? 40 : 168 + brick * 40;
    g = win ? 52 : 148 + brick * 25;
    b = win ? 58 : 128 + brick * 15;
  }
  return {
    z,
    r: Math.max(0, Math.min(255, r * sun)),
    g: Math.max(0, Math.min(255, g * sun)),
    b: Math.max(0, Math.min(255, b * sun)),
    kind,
  };
}

function rayHit(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  world: SyntheticWorld,
): Hit {
  let best: Hit = { z: 1e9, r: 148, g: 168, b: 196, kind: "sky" };
  const steps = 48;
  const maxT = 140;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * maxT;
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const gz = terrainZ(x, y);
    const onRoad = y > 10.4 && y < 13.6 && x > -20 && x < 36;
    if (z <= gz + (onRoad ? 0.08 : 0) && t > 1) {
      const hx = 0.08 * Math.cos(x * 0.12);
      const hy = 0.06 * Math.sin(y * 0.15);
      best = shade(x, y, t, -hx, -hy, 1, onRoad ? "road" : "ground");
      break;
    }
    const b = world.building;
    const hx = b.sx / 2,
      hy = b.sy / 2,
      hz = b.sz / 2;
    if (
      x > b.cx - hx &&
      x < b.cx + hx &&
      y > b.cy - hy &&
      y < b.cy + hy &&
      z > b.cz - hz &&
      z < b.cz + hz
    ) {
      const nx = Math.abs(x - (b.cx - hx)) < 0.35 ? -1 : Math.abs(x - (b.cx + hx)) < 0.35 ? 1 : 0;
      const ny = Math.abs(y - (b.cy - hy)) < 0.35 ? -1 : Math.abs(y - (b.cy + hy)) < 0.35 ? 1 : 0;
      const nz = Math.abs(z - (b.cz + hz)) < 0.35 ? 1 : 0;
      best = shade(x, y, t, nx, ny, nz || 0.4, "bldg");
      break;
    }
  }
  return best;
}

export interface Capture {
  world: SyntheticWorld;
  frames: FrameBuffer[];
  telemetry: TelemetrySample[];
  poses: CameraPose[];
  K: CameraIntrinsics;
  origin: Lla;
}

export function captureSynthetic(mode: ProcessingMode): Capture {
  const world = makeWorld();
  const n = mode === "fast" ? 12 : mode === "accuracy" ? 28 : 18;
  const width = mode === "fast" ? 160 : mode === "accuracy" ? 256 : 208;
  const height = Math.round((width * 9) / 16);
  const K: CameraIntrinsics = {
    fx: width * 0.92,
    fy: width * 0.92,
    cx: (width - 1) / 2,
    cy: (height - 1) / 2,
    width,
    height,
  };
  const frames: FrameBuffer[] = [];
  const telemetry: TelemetrySample[] = [];
  const poses: CameraPose[] = [];

  for (let i = 0; i < n; i++) {
    const u = n <= 1 ? 0 : i / (n - 1);
    const timeS = u * 18;
    const east = -22 + u * 56;
    const north = 18 + 2.5 * Math.sin(u * Math.PI);
    const up = 28 - 1.5 * Math.sin(u * 2);
    const C = { x: east, y: north, z: up };
    const target = { x: 8, y: 3, z: 1.5 };
    const R = lookAtRotation(C, target);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const xn = (px - K.cx) / K.fx;
        const yn = (py - K.cy) / K.fy;
        const d = {
          x: R[0] * xn + R[1] * yn + R[2],
          y: R[3] * xn + R[4] * yn + R[5],
          z: R[6] * xn + R[7] * yn + R[8],
        };
        const nn = Math.hypot(d.x, d.y, d.z) || 1;
        const hit = rayHit(C.x, C.y, C.z, d.x / nn, d.y / nn, d.z / nn, world);
        const o = (py * width + px) * 4;
        rgba[o] = hit.r;
        rgba[o + 1] = hit.g;
        rgba[o + 2] = hit.b;
        rgba[o + 3] = 255;
      }
    }
    const blur = lapVar(rgba, width, height, 2);
    frames.push({
      index: i,
      timeS,
      width,
      height,
      rgba,
      blurScore: blur,
      featureCount: 0,
      sharpness: Math.max(0, Math.min(1, blur / 120)),
    });
    const lat = world.origin.lat + C.y / 111320;
    const lon = world.origin.lon + C.x / (111320 * Math.cos((world.origin.lat * Math.PI) / 180));
    const alt = world.origin.alt + C.z;
    telemetry.push({
      timeS,
      frame: i,
      lla: { lat, lon, alt },
      yawDeg: (Math.atan2(target.x - C.x, target.y - C.y) * 180) / Math.PI,
      pitchDeg: -48,
      rollDeg: 0.4 * Math.sin(u * 6),
      gimbalYawDeg: 0,
      gimbalPitchDeg: -48,
      gimbalRollDeg: 0,
      relAltM: C.z,
      gnss: "standalone",
      source: "synthetic",
    });
    poses.push({
      frameIndex: i,
      timeS,
      R,
      C,
      registered: true,
      reprojErrPx: 0,
      trackCount: 0,
      source: "gps_imu",
    });
  }
  return { world, frames, telemetry, poses, K, origin: world.origin };
}

export function syntheticSrt(capture: Capture): string {
  return capture.telemetry
    .map((s, i) => {
      const t0 = formatTs(s.timeS);
      const t1 = formatTs(s.timeS + 1 / 24);
      const lla = s.lla!;
      return `${i + 1}
${t0} --> ${t1}
[latitude: ${lla.lat.toFixed(7)}] [longitude: ${lla.lon.toFixed(7)}] [rel_alt: ${s.relAltM?.toFixed(2)}] [abs_alt: ${lla.alt.toFixed(2)}] [gb_yaw: ${s.yawDeg?.toFixed(2)}] [gb_pitch: ${s.pitchDeg?.toFixed(2)}] [gb_roll: ${s.rollDeg?.toFixed(2)}]
`;
    })
    .join("\n");
}

function formatTs(t: number): string {
  const ms = Math.round(t * 1000);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const frac = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(frac).padStart(3, "0")}`;
}

export function nearestGtError(p: PointRecord, gt: { x: number; y: number; z: number }[]): number {
  let best = Infinity;
  for (const q of gt) {
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
