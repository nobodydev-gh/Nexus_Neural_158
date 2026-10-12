import type { CameraIntrinsics, CameraPose, FrameBuffer, PointRecord, ProcessingMode } from "./types.ts";
import { projectPoint, triangulate, detectFast, matchBrief, reprojectionError } from "./features.ts";
import { sampleBilinear, localVariance } from "./image.ts";
import { isDynamicPixel } from "./masking.ts";
import { finalizePoint } from "./fusion.ts";
import { vecSub, vecNorm, vecDot } from "./coords.ts";

export function mvsBudget(mode: ProcessingMode) {
  if (mode === "fast") return { stride: 5, refs: 4, sources: 2, patch: 3, iters: 3, maxPts: 8000, nccMin: 0.44 };
  if (mode === "accuracy") return { stride: 3, refs: 8, sources: 3, patch: 4, iters: 6, maxPts: 28000, nccMin: 0.4 };
  return { stride: 4, refs: 6, sources: 2, patch: 3, iters: 4, maxPts: 16000, nccMin: 0.42 };
}

function ncc(
  a: FrameBuffer,
  b: FrameBuffer,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rad: number,
): number {
  let sa = 0,
    sb = 0,
    sa2 = 0,
    sb2 = 0,
    sab = 0,
    n = 0;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const [ar, ag, ab] = sampleBilinear(a.rgba, a.width, a.height, ax + dx, ay + dy);
      const [br, bg, bb] = sampleBilinear(b.rgba, b.width, b.height, bx + dx, by + dy);
      if (ar < 0 || br < 0) continue;
      const ia = 0.299 * ar + 0.587 * ag + 0.114 * ab;
      const ib = 0.299 * br + 0.587 * bg + 0.114 * bb;
      sa += ia;
      sb += ib;
      sa2 += ia * ia;
      sb2 += ib * ib;
      sab += ia * ib;
      n++;
    }
  }
  if (n < 6) return -1;
  const num = n * sab - sa * sb;
  const den = Math.sqrt(Math.max(1e-6, n * sa2 - sa * sa) * Math.max(1e-6, n * sb2 - sb * sb));
  return num / den;
}

function colorAt(f: FrameBuffer, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * f.width + Math.round(x)) * 4;
  if (i < 0 || i + 2 >= f.rgba.length) return [128, 128, 128];
  return [f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]];
}

function viewAngleDeg(pose: CameraPose, P: { x: number; y: number; z: number }): number {
  const d = vecSub(P, pose.C);
  const n = vecNorm(d) || 1;
  const fwd = { x: pose.R[2], y: pose.R[5], z: pose.R[8] };
  const c = Math.max(-1, Math.min(1, vecDot({ x: d.x / n, y: d.y / n, z: d.z / n }, fwd)));
  return (Math.acos(c) * 180) / Math.PI;
}

export function sparseCloud(
  frames: FrameBuffer[],
  poses: CameraPose[],
  K: CameraIntrinsics,
): PointRecord[] {
  const poseOf = (idx: number) => poses.find((p) => p.frameIndex === idx);
  const kps = frames.map((f) => detectFast(f, 320, 2));
  for (let i = 0; i < frames.length; i++) frames[i].featureCount = kps[i].length;
  const pts: PointRecord[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const bi = Math.min(frames.length - 1, i + 1);
    const b = frames[bi];
    const pa = poseOf(a.index);
    const pb = poseOf(b.index);
    if (!pa || !pb) continue;
    const matches = matchBrief(kps[i], kps[bi]);
    for (const m of matches) {
      const ka = kps[i][m.i];
      const kb = kps[bi][m.j];
      if (isDynamicPixel(a, ka.x | 0, ka.y | 0)) continue;
      const P = triangulate(ka.x, ka.y, kb.x, kb.y, pa, pb, K);
      if (!P) continue;
      const e1 = reprojectionError(P, pa, K, ka.x, ka.y);
      const e2 = reprojectionError(P, pb, K, kb.x, kb.y);
      if (e1 > 3.5 || e2 > 3.5) continue;
      const col = colorAt(a, ka.x, ka.y);
      const ang = Math.abs(viewAngleDeg(pa, P) - viewAngleDeg(pb, P));
      pts.push(
        finalizePoint({
          x: P.x,
          y: P.y,
          z: P.z,
          r: col[0] / 255,
          g: col[1] / 255,
          b: col[2] / 255,
          observations: 2,
          angleDiversityDeg: ang,
          reprojErrPx: 0.5 * (e1 + e2),
          depthConsistency: 0.85,
          density: 0.4,
          imageQuality: a.sharpness,
          dynamicProb: 0,
          visibility: 1,
          source: "sfm",
        }),
      );
    }
  }
  return pts;
}

function depthHypothesis(pref: CameraPose, K: CameraIntrinsics, x: number, y: number, z: number) {
  const xn = (x - K.cx) / K.fx;
  const yn = (y - K.cy) / K.fy;
  return {
    x: pref.C.x + (pref.R[0] * xn + pref.R[1] * yn + pref.R[2]) * z,
    y: pref.C.y + (pref.R[3] * xn + pref.R[4] * yn + pref.R[5]) * z,
    z: pref.C.z + (pref.R[6] * xn + pref.R[7] * yn + pref.R[8]) * z,
  };
}

/**
 * Multi-view stereo backbone: PatchMatch-style photoconsistency along
 * the known (or SfM-refined) camera rays. This is metric geometry from
 * triangulation, not monocular depth.
 */
export async function denseMvs(
  frames: FrameBuffer[],
  poses: CameraPose[],
  K: CameraIntrinsics,
  mode: ProcessingMode,
  onProgress?: (frac: number) => void,
): Promise<PointRecord[]> {
  const bud = mvsBudget(mode);
  const poseOf = (idx: number) => poses.find((p) => p.frameIndex === idx && p.registered);
  const refs: number[] = [];
  const step = Math.max(1, Math.floor(frames.length / bud.refs));
  for (let i = 0; i < frames.length && refs.length < bud.refs; i += step) refs.push(i);
  if (!refs.includes(frames.length - 1) && frames.length > 1) refs.push(frames.length - 1);

  const points: PointRecord[] = [];
  for (let ri = 0; ri < refs.length; ri++) {
    const fi = refs[ri];
    const ref = frames[fi];
    const pref = poseOf(ref.index);
    if (!pref) continue;
    const sources: FrameBuffer[] = [];
    for (let s = 1; s <= bud.sources; s++) {
      const sj = fi + s;
      if (sj < frames.length) sources.push(frames[sj]);
    }
    if (!sources.length && fi > 0) sources.push(frames[fi - 1]);
    const srcPoses = sources
      .map((s) => poseOf(s.index))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (!srcPoses.length) continue;

    const alt = Math.max(8, Math.abs(pref.C.z));
    const z0 = Math.max(3, alt * 0.22);
    const z1 = Math.max(z0 + 10, alt * 3.4);
    const steps = 10 + bud.iters * 2;

    for (let y = 4; y < ref.height - 4; y += bud.stride) {
      for (let x = 4; x < ref.width - 4; x += bud.stride) {
        if (isDynamicPixel(ref, x, y)) continue;
        if (localVariance(ref.rgba, ref.width, x, y, 2) < 18) continue;
        let bestScore = -1;
        let bestP: { x: number; y: number; z: number } | null = null;
        let bestZ = 0;
        let bestCons = 0;
        for (let k = 0; k < steps; k++) {
          const u = k / Math.max(1, steps - 1);
          // Inverse-depth sampling — denser near expected ground.
          const inv0 = 1 / z1;
          const inv1 = 1 / z0;
          const z = 1 / (inv0 + (inv1 - inv0) * u);
          const P = depthHypothesis(pref, K, x, y, z);
          let score = 0;
          let n = 0;
          for (let si = 0; si < sources.length; si++) {
            const sp = srcPoses[si];
            if (!sp) continue;
            const pr = projectPoint(P, sp, K);
            if (!pr) continue;
            const c = ncc(ref, sources[si], x, y, pr.u, pr.v, bud.patch);
            if (c < 0) continue;
            score += c;
            n++;
          }
          if (!n) continue;
          score /= n;
          if (score > bestScore) {
            bestScore = score;
            bestP = P;
            bestZ = z;
            bestCons = n;
          }
        }
        if (!bestP || bestScore < bud.nccMin) continue;
        let zBest = bestZ;
        for (let it = 0; it < bud.iters; it++) {
          const span = (z1 - z0) / (8 * (it + 1));
          for (const dz of [-span, 0, span]) {
            const z = zBest + dz;
            if (z < z0 || z > z1) continue;
            const P = depthHypothesis(pref, K, x, y, z);
            let score = 0,
              n = 0;
            for (let si = 0; si < sources.length; si++) {
              const sp = srcPoses[si];
              if (!sp) continue;
              const pr = projectPoint(P, sp, K);
              if (!pr) continue;
              const c = ncc(ref, sources[si], x, y, pr.u, pr.v, bud.patch);
              if (c < 0) continue;
              score += c;
              n++;
            }
            if (n && score / n > bestScore) {
              bestScore = score / n;
              bestP = P;
              zBest = z;
              bestCons = n;
            }
          }
        }
        if (!bestP) continue;
        const col = colorAt(ref, x, y);
        const ang =
          sources.length && srcPoses[0]
            ? Math.abs(viewAngleDeg(pref, bestP) - viewAngleDeg(srcPoses[0], bestP))
            : 4;
        points.push(
          finalizePoint({
            x: bestP.x,
            y: bestP.y,
            z: bestP.z,
            r: col[0] / 255,
            g: col[1] / 255,
            b: col[2] / 255,
            observations: 1 + bestCons,
            angleDiversityDeg: ang,
            reprojErrPx: Math.max(0.3, 2.2 * (1 - bestScore)),
            depthConsistency: bestScore,
            density: 0.5,
            imageQuality: ref.sharpness,
            dynamicProb: 0,
            visibility: 1,
            source: "mvs",
          }),
        );
        if (points.length >= bud.maxPts) {
          onProgress?.(1);
          return points;
        }
      }
      if (y % (bud.stride * 8) === 0) {
        onProgress?.((ri + y / ref.height) / refs.length);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    onProgress?.((ri + 1) / refs.length);
  }
  return points;
}

/**
 * Selective "AI depth" analogue that is strictly geometric: for pixels where
 * MVS photoconsistency is weak, try a third view + smoothness from neighbors.
 * Regions that still fail stay unobserved — never hallucinated as HIGH.
 *
 * Depth Anything V2 is the documented native hook (hooks.ts). In-browser we
 * do not pretend a monocular network ran.
 */
export function selectiveFill(
  weakFrame: FrameBuffer,
  pose: CameraPose,
  neighbor: FrameBuffer | undefined,
  nPose: CameraPose | undefined,
  K: CameraIntrinsics,
  seeds: PointRecord[],
): PointRecord[] {
  if (!neighbor || !nPose) return [];
  const added: PointRecord[] = [];
  const stride = 8;
  const alt = Math.max(8, Math.abs(pose.C.z));
  for (let y = 6; y < weakFrame.height - 6; y += stride) {
    for (let x = 6; x < weakFrame.width - 6; x += stride) {
      if (isDynamicPixel(weakFrame, x, y)) continue;
      if (localVariance(weakFrame.rgba, weakFrame.width, x, y, 2) < 10) continue;
      let nearby = false;
      for (const s of seeds) {
        const pr = projectPoint(s, pose, K);
        if (pr && Math.hypot(pr.u - x, pr.v - y) < 6) {
          nearby = true;
          break;
        }
      }
      if (nearby) continue;
      let best: PointRecord | null = null;
      let bestS = -1;
      for (let k = 0; k < 10; k++) {
        const z = alt * 0.3 + k * (alt * 0.28);
        const cand = depthHypothesis(pose, K, x, y, z);
        const pr = projectPoint(cand, nPose, K);
        if (!pr) continue;
        const c = ncc(weakFrame, neighbor, x, y, pr.u, pr.v, 3);
        if (c > bestS) {
          bestS = c;
          const col = colorAt(weakFrame, x, y);
          best = finalizePoint({
            x: cand.x,
            y: cand.y,
            z: cand.z,
            r: col[0] / 255,
            g: col[1] / 255,
            b: col[2] / 255,
            observations: 2,
            angleDiversityDeg: 6,
            reprojErrPx: 2.4,
            depthConsistency: Math.max(0, c),
            density: 0.25,
            imageQuality: weakFrame.sharpness * 0.8,
            dynamicProb: 0.05,
            visibility: 0.6,
            source: "ai_depth",
          });
        }
      }
      if (best && bestS >= 0.36 && best.klass !== "unobserved") added.push(best);
    }
  }
  return added;
}

export { triangulate };
