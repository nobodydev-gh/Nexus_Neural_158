import type { CameraPose, ConfidenceClass, PointRecord } from "./types.ts";

export function classifyConfidence(score: number, observations: number): ConfidenceClass {
  if (observations <= 0 || score < 0.12) return "unobserved";
  if (score >= 0.72 && observations >= 3) return "high";
  if (score >= 0.42 && observations >= 2) return "medium";
  return "low";
}

/**
 * Observability score used both for fusion weights and measurement warnings.
 * Not a visualization-only overlay.
 */
export function scorePoint(p: {
  observations: number;
  angleDiversityDeg: number;
  reprojErrPx: number;
  depthConsistency: number;
  density: number;
  imageQuality: number;
  dynamicProb: number;
  visibility: number;
}): number {
  const nObs = Math.min(1, p.observations / 5);
  const angles = Math.min(1, p.angleDiversityDeg / 35);
  const reproj = Math.max(0, 1 - p.reprojErrPx / 4);
  const depth = Math.max(0, Math.min(1, p.depthConsistency));
  const dens = Math.min(1, p.density);
  const iq = Math.max(0, Math.min(1, p.imageQuality));
  const dyn = 1 - Math.max(0, Math.min(1, p.dynamicProb));
  const vis = Math.max(0, Math.min(1, p.visibility));
  return (
    0.18 * nObs +
    0.16 * angles +
    0.16 * reproj +
    0.14 * depth +
    0.1 * dens +
    0.08 * iq +
    0.1 * dyn +
    0.08 * vis
  );
}

export function finalizePoint(partial: Omit<PointRecord, "confidence" | "klass">): PointRecord {
  const confidence = scorePoint(partial);
  const klass = classifyConfidence(confidence, partial.observations);
  return { ...partial, confidence, klass };
}

export function coverageHistogram(points: PointRecord[]): Record<ConfidenceClass, number> {
  const c = { high: 0, medium: 0, low: 0, unobserved: 0 };
  if (!points.length) return c;
  for (const p of points) c[p.klass]++;
  const n = points.length;
  return {
    high: c.high / n,
    medium: c.medium / n,
    low: c.low / n,
    unobserved: c.unobserved / n,
  };
}

/** Voxel downsample, keeping a confidence-weighted mean per cell. */
export function voxelFuse(points: PointRecord[], cellM: number): PointRecord[] {
  const map = new Map<string, PointRecord>();
  const inv = 1 / Math.max(0.15, cellM);
  for (const p of points) {
    const k = `${Math.round(p.x * inv)}:${Math.round(p.y * inv)}:${Math.round(p.z * inv)}`;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, p);
      continue;
    }
    const w0 = Math.max(0.05, prev.confidence) * (prev.source === "ai_depth" ? 0.45 : 1);
    const w1 = Math.max(0.05, p.confidence) * (p.source === "ai_depth" ? 0.45 : 1);
    const w = w0 + w1;
    const fused: PointRecord = finalizePoint({
      x: (prev.x * w0 + p.x * w1) / w,
      y: (prev.y * w0 + p.y * w1) / w,
      z: (prev.z * w0 + p.z * w1) / w,
      r: (prev.r * w0 + p.r * w1) / w,
      g: (prev.g * w0 + p.g * w1) / w,
      b: (prev.b * w0 + p.b * w1) / w,
      observations: prev.observations + p.observations,
      angleDiversityDeg: Math.max(prev.angleDiversityDeg, p.angleDiversityDeg),
      reprojErrPx: (prev.reprojErrPx * w0 + p.reprojErrPx * w1) / w,
      depthConsistency: (prev.depthConsistency * w0 + p.depthConsistency * w1) / w,
      density: Math.min(1, prev.density + p.density),
      imageQuality: Math.max(prev.imageQuality, p.imageQuality),
      dynamicProb: Math.min(prev.dynamicProb, p.dynamicProb),
      visibility: Math.max(prev.visibility, p.visibility),
      source: prev.source === p.source ? prev.source : "fused",
    });
    map.set(k, fused);
  }
  return [...map.values()];
}

export function densityEstimate(points: PointRecord[], k = 6): void {
  if (points.length < k + 1) {
    for (const p of points) p.density = 0.2;
    return;
  }
  const sample = points.length > 2500 ? 2500 : points.length;
  const step = Math.max(1, Math.floor(points.length / sample));
  const subset = points.filter((_, i) => i % step === 0);
  for (const p of points) {
    const d: number[] = [];
    for (const q of subset) {
      const dx = p.x - q.x,
        dy = p.y - q.y,
        dz = p.z - q.z;
      d.push(dx * dx + dy * dy + dz * dz);
    }
    d.sort((a, b) => a - b);
    const nn = Math.sqrt(d[Math.min(k, d.length - 1)] || 1);
    p.density = Math.max(0, Math.min(1, 1.2 / (1 + nn)));
  }
}

/**
 * GPS-altitude range gate + must sit in front of at least one registered camera.
 * Drops triangulations behind the trajectory or kilometres off the strip.
 */
export function rangeGate(points: PointRecord[], poses: CameraPose[]): PointRecord[] {
  const registered = poses.filter((p) => p.registered);
  if (!registered.length) return points;
  const alts = registered.map((p) => p.C.z).sort((a, b) => a - b);
  const alt = alts[alts.length >> 1];
  const zMin = alt - Math.max(12, alt * 1.25);
  const zMax = alt + Math.max(8, alt * 0.3);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of registered) {
    if (p.C.x < minX) minX = p.C.x;
    if (p.C.y < minY) minY = p.C.y;
    if (p.C.x > maxX) maxX = p.C.x;
    if (p.C.y > maxY) maxY = p.C.y;
  }
  const pad = Math.max(14, Math.abs(alt) * 1.35);
  return points.filter((p) => {
    if (p.z < zMin || p.z > zMax) return false;
    if (p.x < minX - pad || p.x > maxX + pad) return false;
    if (p.y < minY - pad || p.y > maxY + pad) return false;
    for (const pose of registered) {
      const dx = p.x - pose.C.x;
      const dy = p.y - pose.C.y;
      const dz = p.z - pose.C.z;
      if (dx * pose.R[2] + dy * pose.R[5] + dz * pose.R[8] > 1.2) return true;
    }
    return false;
  });
}

/** Median-absolute-deviation filter on k-NN spacing (PCL-style statistical removal). */
export function statisticalOutliers(points: PointRecord[], k = 6, stdRatio = 2.2): PointRecord[] {
  if (points.length < Math.max(12, k + 2)) return points;
  const n = points.length;
  const meanD = new Float64Array(n);
  const sampleStep = n > 4000 ? Math.ceil(n / 4000) : 1;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const ds: number[] = [];
    for (let j = 0; j < n; j += sampleStep) {
      if (i === j) continue;
      const q = points[j];
      ds.push((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
    }
    ds.sort((a, b) => a - b);
    let acc = 0;
    const take = Math.min(k, ds.length);
    for (let t = 0; t < take; t++) acc += Math.sqrt(ds[t]);
    meanD[i] = acc / take;
  }
  const sorted = Array.from(meanD).sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const madArr = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = madArr[madArr.length >> 1] || 1e-6;
  const cut = med + stdRatio * 1.4826 * mad;
  return points.filter((_, i) => meanD[i] <= cut);
}
