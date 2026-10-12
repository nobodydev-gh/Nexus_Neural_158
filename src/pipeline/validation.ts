import type { PointRecord, ReconstructResult, ValidationReport } from "./types.ts";
import { nearestGtError } from "./synthetic.ts";

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo];
  return s[lo] * (hi - i) + s[hi] * (i - lo);
}

export function rmse(xs: number[]): number {
  if (!xs.length) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);
}

export function validateAgainstGt(
  points: PointRecord[],
  gt: { x: number; y: number; z: number }[] | null,
  registeredRatio: number,
  meanReprojPx: number,
  trackCount: number,
  georefRmse: number | undefined,
  observedFraction: number,
): ValidationReport {
  const noteReprojVsWorld =
    "Reprojection error is an image-space residual of the SfM/MVS solve. It is not real-world accuracy. Metre-class error requires independent checkpoints, RTK/PPK, or a known dimension.";

  if (!gt || gt.length < 8) {
    return {
      hasIndependentGt: false,
      disclaimer:
        "Absolute accuracy has not been independently established. No ground-truth checkpoints were provided. Reported reprojection error must not be quoted as survey accuracy.",
      completeness: observedFraction,
      observedFraction,
      meanReprojPx,
      registeredRatio,
      trackCount,
      georefRmse,
      noteReprojVsWorld,
    };
  }
  const usable = points.filter((p) => p.klass === "high" || p.klass === "medium");
  const sample = usable.length > 1200 ? usable.filter((_, i) => i % Math.ceil(usable.length / 1200) === 0) : usable;
  const err3: number[] = [];
  const errX: number[] = [];
  const errY: number[] = [];
  const errZ: number[] = [];
  for (const p of sample) {
    let best = Infinity;
    let bx = 0,
      by = 0,
      bz = 0;
    for (const q of gt) {
      const dx = p.x - q.x,
        dy = p.y - q.y,
        dz = p.z - q.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) {
        best = d;
        bx = dx;
        by = dy;
        bz = dz;
      }
    }
    err3.push(Math.sqrt(best));
    errX.push(bx);
    errY.push(by);
    errZ.push(bz);
  }
  const completeness = gt.length
    ? gt.filter((q) => {
        let best = Infinity;
        for (const p of sample) {
          const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
          if (d < best) best = d;
        }
        return Math.sqrt(best) < 2.5;
      }).length / gt.length
    : 0;

  return {
    hasIndependentGt: true,
    disclaimer:
      "Errors below are nearest-neighbor distances to the synthetic / checkpoint surface. They describe this reconstruction, not a general accuracy guarantee.",
    rmseX: rmse(errX),
    rmseY: rmse(errY),
    rmseZ: rmse(errZ),
    rmse3d: rmse(err3),
    medianError: percentile(err3, 0.5),
    p95Error: percentile(err3, 0.95),
    measurementError: percentile(err3, 0.5),
    completeness,
    observedFraction,
    meanReprojPx,
    registeredRatio,
    trackCount,
    georefRmse,
    cameraTrajectoryRmse: georefRmse,
    noteReprojVsWorld,
  };
}

export function observedFractionFromCoverage(c: ReconstructResult["coverage"]): number {
  return 1 - c.unobserved;
}

export { nearestGtError };
