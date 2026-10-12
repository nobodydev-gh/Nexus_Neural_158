import { haversineM } from "./coords.ts";
import { histDiff, histogram64, laplacianVariance, meanAbsDiff } from "./image.ts";
import type { FrameBuffer, KeyframeRecord, ProcessingMode, TelemetrySample } from "./types.ts";
import { sampleAt } from "./ingestion.ts";

export interface KeyframeParams {
  mode: ProcessingMode;
  minBlurVar: number;
  minSpatialM: number;
  minOverlap: number;
  maxOverlap: number;
  minParallaxDeg: number;
  minSceneChange: number;
  maxFrames: number;
}

export function keyframeParams(mode: ProcessingMode): KeyframeParams {
  if (mode === "fast") {
    return {
      mode,
      minBlurVar: 18,
      minSpatialM: 4.5,
      minOverlap: 0.55,
      maxOverlap: 0.92,
      minParallaxDeg: 3,
      minSceneChange: 0.04,
      maxFrames: 16,
    };
  }
  if (mode === "accuracy") {
    return {
      mode,
      minBlurVar: 12,
      minSpatialM: 2.2,
      minOverlap: 0.62,
      maxOverlap: 0.94,
      minParallaxDeg: 2,
      minSceneChange: 0.02,
      maxFrames: 40,
    };
  }
  return {
    mode,
    minBlurVar: 14,
    minSpatialM: 3.2,
    minOverlap: 0.58,
    maxOverlap: 0.93,
    minParallaxDeg: 2.5,
    minSceneChange: 0.03,
    maxFrames: 24,
  };
}

function estimateOverlap(spatialM: number, altM: number, fovDeg = 70): number {
  const groundW = 2 * Math.max(8, altM) * Math.tan(((fovDeg / 2) * Math.PI) / 180);
  return Math.max(0, Math.min(1, 1 - spatialM / Math.max(groundW, 1)));
}

function estimateParallax(spatialM: number, altM: number): number {
  return (Math.atan2(spatialM, Math.max(8, altM)) * 180) / Math.PI;
}

/**
 * Adaptive keyframe selection. Not a fixed "every 3 m" sampler.
 * Combines blur, feature quality, motion, spatial displacement, overlap,
 * viewpoint/parallax, and scene-change — then caps to mode budget.
 */
export function selectKeyframes(
  frames: FrameBuffer[],
  telemetry: TelemetrySample[],
  mode: ProcessingMode,
): KeyframeRecord[] {
  const p = keyframeParams(mode);
  const records: KeyframeRecord[] = [];
  let lastSel = -1;
  let lastHist: Float32Array | null = null;
  let lastRgba: Uint8ClampedArray | null = null;
  let lastTel = telemetry[0];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const tel = sampleAt(telemetry, f.timeS) ?? lastTel;
    lastTel = tel ?? lastTel;
    const blur = f.blurScore || laplacianVariance(f.rgba, f.width, f.height, 3);
    f.blurScore = blur;
    const sharp = Math.max(0, Math.min(1, blur / 120));
    f.sharpness = sharp;

    let spatialM = 0;
    if (lastSel >= 0) {
      const prev = sampleAt(telemetry, frames[lastSel].timeS);
      if (prev?.lla && tel?.lla) spatialM = haversineM(prev.lla, tel.lla);
      else spatialM = Math.abs(f.timeS - frames[lastSel].timeS) * 8;
    }
    const alt = tel?.relAltM ?? tel?.lla?.alt ?? 40;
    const overlap = lastSel < 0 ? 1 : estimateOverlap(spatialM, alt);
    const parallax = lastSel < 0 ? 0 : estimateParallax(spatialM, alt);
    const hist = histogram64(f.rgba, f.width, f.height);
    const sceneChange = lastHist ? histDiff(hist, lastHist) : 1;
    const motionPx = lastRgba ? meanAbsDiff(f.rgba, lastRgba, f.width, f.height, 5) : 255;
    const featureQuality = Math.max(0, Math.min(1, (f.featureCount || blur) / 400));

    const reasons: string[] = [];
    const sharpEnough = blur >= p.minBlurVar;
    if (!sharpEnough) reasons.push("blur");

    let selected = false;
    if (lastSel < 0 && sharpEnough) {
      selected = true;
      reasons.push("first");
    } else if (sharpEnough) {
      const moved = spatialM >= p.minSpatialM;
      const parallaxOk = parallax >= p.minParallaxDeg;
      const overlapLow = overlap <= p.maxOverlap;
      const scene = sceneChange >= p.minSceneChange;
      const motion = motionPx > 14;
      const stillOverlaps = overlap >= p.minOverlap;
      // Keep if we have useful new geometry without losing track
      if (stillOverlaps && ((moved && overlapLow) || (parallaxOk && scene) || (motion && scene))) {
        selected = true;
        if (moved) reasons.push("spatial");
        if (parallaxOk) reasons.push("parallax");
        if (scene) reasons.push("scene");
        if (featureQuality > 0.35) reasons.push("features");
        if (motion) reasons.push("motion");
      }
    }

    records.push({
      frameIndex: f.index,
      timeS: f.timeS,
      blurScore: blur,
      featureQuality,
      motionPx,
      spatialM,
      overlap,
      parallaxDeg: parallax,
      sceneChange,
      selected,
      reasons,
    });
    if (selected) {
      lastSel = i;
      lastHist = hist;
      lastRgba = f.rgba;
    }
  }

  // Always keep last sharp frame for trajectory closure
  const lastSharp = [...records].reverse().find((r) => r.blurScore >= p.minBlurVar);
  if (lastSharp && !lastSharp.selected) {
    lastSharp.selected = true;
    lastSharp.reasons.push("last");
  }

  let selected = records.filter((r) => r.selected);
  if (selected.length > p.maxFrames) {
    // Uniform-in-time subsample of already-adaptive set (preserves endpoints).
    const keep = new Set<number>();
    keep.add(selected[0].frameIndex);
    keep.add(selected[selected.length - 1].frameIndex);
    const inner = p.maxFrames - 2;
    for (let k = 1; k <= inner; k++) {
      const idx = Math.round((k * (selected.length - 1)) / (inner + 1));
      keep.add(selected[idx].frameIndex);
    }
    for (const r of records) {
      if (r.selected && !keep.has(r.frameIndex)) {
        r.selected = false;
        r.reasons.push("budget");
      }
    }
    selected = records.filter((r) => r.selected);
  }
  return records;
}

export function selectedFrames(frames: FrameBuffer[], records: KeyframeRecord[]): FrameBuffer[] {
  const set = new Set(records.filter((r) => r.selected).map((r) => r.frameIndex));
  return frames.filter((f) => set.has(f.index));
}
