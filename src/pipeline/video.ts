import type { FrameBuffer } from "./types.ts";
import { laplacianVariance } from "./image.ts";

/**
 * Extract frames on the main thread (HTMLVideoElement is not available in workers).
 * Returns RGBA buffers at a working resolution chosen by mode.
 */
export async function extractVideoFrames(
  file: Blob,
  opts: { maxWidth: number; targetFps: number; maxFrames: number; onProgress?: (f: number) => void },
): Promise<{ frames: FrameBuffer[]; durationS: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await waitEvent(video, "loadedmetadata");
    const durationS = video.duration;
    const scale = Math.min(1, opts.maxWidth / Math.max(1, video.videoWidth));
    const width = Math.max(32, Math.round(video.videoWidth * scale) & ~1);
    const height = Math.max(32, Math.round(video.videoHeight * scale) & ~1);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");

    const n = Math.min(opts.maxFrames, Math.max(2, Math.round(durationS * opts.targetFps)));
    const frames: FrameBuffer[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / Math.max(1, n - 1)) * Math.max(0, durationS - 0.05);
      await seek(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      const img = ctx.getImageData(0, 0, width, height);
      const rgba = img.data;
      frames.push({
        index: i,
        timeS: t,
        width,
        height,
        rgba,
        blurScore: laplacianVariance(rgba, width, height, 3),
        featureCount: 0,
        sharpness: 0,
      });
      opts.onProgress?.((i + 1) / n);
    }
    return { frames, durationS, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitEvent(el: HTMLVideoElement, ev: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onErr = () => reject(new Error("Video failed to load"));
    el.addEventListener(ev, () => resolve(), { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const on = () => {
      video.removeEventListener("seeked", on);
      resolve();
    };
    video.addEventListener("seeked", on);
    video.currentTime = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.04));
  });
}
