import type { CameraPose, GnssQuality, Lla, PointRecord, ReconstructResult, TelemetrySample } from "./types.ts";
import {
  applySim3,
  enuFrame,
  llaToEnu,
  makeIdentitySim3,
  sim3Rmse,
  umeyamaSim3,
  type Sim3,
} from "./coords.ts";
import { sampleAt } from "./ingestion.ts";

export function posesFromTelemetry(
  telemetry: TelemetrySample[],
  frames: { index: number; timeS: number }[],
  origin: Lla,
  lookTarget?: { x: number; y: number; z: number },
): { poses: CameraPose[]; frame: ReturnType<typeof enuFrame>; gnss: GnssQuality } {
  const frame = enuFrame(origin);
  const rank: GnssQuality[] = ["none", "standalone", "dgps", "rtk_float", "ppk", "rtk_fixed"];
  let gnss: GnssQuality = "none";
  const poses: CameraPose[] = [];
  for (const f of frames) {
    const s = sampleAt(telemetry, f.timeS);
    if (!s?.lla) {
      poses.push({
        frameIndex: f.index,
        timeS: f.timeS,
        R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        C: { x: 0, y: 0, z: 0 },
        registered: false,
        reprojErrPx: 0,
        trackCount: 0,
        source: "gps_imu",
      });
      continue;
    }
    if (rank.indexOf(s.gnss) > rank.indexOf(gnss)) gnss = s.gnss;
    const C = llaToEnu(s.lla, frame);
    const target = lookTarget ?? { x: C.x, y: C.y + 8, z: 0 };
    // Prefer gimbal attitude if present, else look-at the scene center.
    const R = lookAtFromEnu(C, target);
    poses.push({
      frameIndex: f.index,
      timeS: f.timeS,
      R,
      C,
      registered: true,
      reprojErrPx: 0,
      trackCount: 0,
      source: "gps_imu",
    });
  }
  return { poses, frame, gnss };
}

function lookAtFromEnu(C: { x: number; y: number; z: number }, T: { x: number; y: number; z: number }) {
  const fx = T.x - C.x,
    fy = T.y - C.y,
    fz = T.z - C.z;
  const fn = Math.hypot(fx, fy, fz) || 1;
  const z = { x: fx / fn, y: fy / fn, z: fz / fn };
  let x = { x: z.y, y: -z.x, z: 0 };
  const xn = Math.hypot(x.x, x.y, x.z) || 1;
  x = { x: x.x / xn, y: x.y / xn, z: x.z / xn };
  const y = {
    x: x.y * z.z - x.z * z.y,
    y: x.z * z.x - x.x * z.z,
    z: x.x * z.y - x.y * z.x,
  };
  return [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z];
}

export function alignToGps(
  localPoses: CameraPose[],
  gpsPoses: CameraPose[],
): { sim3: Sim3; rmse: number; aligned: CameraPose[] } {
  const src: { x: number; y: number; z: number }[] = [];
  const dst: { x: number; y: number; z: number }[] = [];
  for (const lp of localPoses) {
    const g = gpsPoses.find((p) => p.frameIndex === lp.frameIndex && p.registered);
    if (!g || !lp.registered) continue;
    src.push(lp.C);
    dst.push(g.C);
  }
  if (src.length < 3) {
    const identity = makeIdentitySim3();
    return { sim3: identity, rmse: 0, aligned: localPoses };
  }
  const sim3 = umeyamaSim3(src, dst);
  const rmse = sim3Rmse(src, dst, sim3);
  const aligned = localPoses.map((p) => ({
    ...p,
    C: applySim3(p.C, sim3),
  }));
  return { sim3, rmse, aligned };
}

export function applySim3ToPoints(points: PointRecord[], sim3: Sim3): PointRecord[] {
  return points.map((p) => {
    const q = applySim3({ x: p.x, y: p.y, z: p.z }, sim3);
    return { ...p, x: q.x, y: q.y, z: q.z };
  });
}

export function gpsAccuracyStatement(q: GnssQuality): string {
  switch (q) {
    case "rtk_fixed":
      return "RTK fixed: centimetre-level relative GNSS possible. Absolute accuracy still depends on datum and base.";
    case "rtk_float":
      return "RTK float: typically decimetre-level. Not centimetre-class until fixed.";
    case "ppk":
      return "PPK: high-accuracy mode after post-processing. Requires a valid base log.";
    case "dgps":
      return "DGPS/SBAS: metre-class. Do not treat as survey-grade.";
    case "standalone":
      return "Standalone GNSS is typically 2–5 m (often worse under canopy or near façades). This does not provide ≤1 m absolute accuracy.";
    default:
      return "No GNSS. Model is in an arbitrary local frame; absolute georeferencing is unavailable.";
  }
}

export function serializeGeoref(result: Pick<ReconstructResult, "origin" | "georef" | "cameras">) {
  return {
    datum: "WGS84",
    frame: "ENU",
    origin: result.origin,
    sim3: result.georef.sim3,
    gnssQuality: result.georef.gnssQuality,
    cameras: result.cameras.map((c) => ({
      frameIndex: c.frameIndex,
      timeS: c.timeS,
      C: c.C,
      R: c.R,
      registered: c.registered,
      source: c.source,
      reprojErrPx: c.reprojErrPx,
    })),
  };
}
