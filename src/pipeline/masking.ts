import type { CameraIntrinsics, CameraPose, FrameBuffer } from "./types.ts";
import { lumaAt, sampleBilinear } from "./image.ts";
import { invertR } from "./coords.ts";

/**
 * Dynamic-object masking without a cloud YOLO call.
 * Compensates ego-motion with a homography-at-infinity (rotation-dominant)
 * warp, then thresholds residual. Large residual blobs = movers.
 *
 * External hook: replace `maskDynamic` with YOLO+ByteTrack masks when a
 * native worker is attached (see hooks.ts).
 */
export function maskDynamic(
  frames: FrameBuffer[],
  poses: CameraPose[],
  K: CameraIntrinsics,
): number {
  if (frames.length < 2) return 0;
  let dynamicPixels = 0;
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const mask = new Uint8Array(f.width * f.height);
    const prev = frames[Math.max(0, i - 1)];
    const poseA = poses.find((p) => p.frameIndex === prev.index);
    const poseB = poses.find((p) => p.frameIndex === f.index);
    if (!poseA || !poseB) {
      f.dynamicMask = mask;
      continue;
    }
    const { width: w, height: h } = f;
    const step = 2;
    for (let y = 2; y < h - 2; y += step) {
      for (let x = 2; x < w - 2; x += step) {
        const [wx, wy] = warpByRotation(x, y, poseB, poseA, K);
        const [r, g, b] = sampleBilinear(prev.rgba, prev.width, prev.height, wx, wy);
        if (r < 0) continue;
        const i0 = (y * w + x) * 4;
        const residual =
          Math.abs(f.rgba[i0] - r) + Math.abs(f.rgba[i0 + 1] - g) + Math.abs(f.rgba[i0 + 2] - b);
        const tex = Math.abs(
          lumaAt(f.rgba, w, x, y) - lumaAt(f.rgba, w, Math.min(w - 1, x + 2), y),
        );
        // Movers: high residual, not just untextured mismatch
        const dyn = residual > 90 && tex > 8 ? 1 : 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= w || yy >= h) continue;
            mask[yy * w + xx] = dyn;
            total++;
            dynamicPixels += dyn;
          }
        }
      }
    }
    f.dynamicMask = mask;
  }
  return total ? dynamicPixels / total : 0;
}

function warpByRotation(
  u: number,
  v: number,
  from: CameraPose,
  to: CameraPose,
  K: CameraIntrinsics,
): [number, number] {
  const xn = (u - K.cx) / K.fx;
  const yn = (v - K.cy) / K.fy;
  // direction in world
  const d = {
    x: from.R[0] * xn + from.R[1] * yn + from.R[2],
    y: from.R[3] * xn + from.R[4] * yn + from.R[5],
    z: from.R[6] * xn + from.R[7] * yn + from.R[8],
  };
  const Rcw = invertR(to.R);
  const x = Rcw[0] * d.x + Rcw[1] * d.y + Rcw[2] * d.z;
  const y = Rcw[3] * d.x + Rcw[4] * d.y + Rcw[5] * d.z;
  const z = Rcw[6] * d.x + Rcw[7] * d.y + Rcw[8] * d.z;
  if (z <= 1e-4) return [-1, -1];
  return [K.fx * (x / z) + K.cx, K.fy * (y / z) + K.cy];
}

export function isDynamicPixel(frame: FrameBuffer, x: number, y: number): boolean {
  if (!frame.dynamicMask) return false;
  const i = y * frame.width + x;
  return frame.dynamicMask[i] === 1;
}
