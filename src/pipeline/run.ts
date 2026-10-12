import type {
  AccuracyLimitations,
  CameraPose,
  FrameBuffer,
  PipelineStage,
  ReconstructConfig,
  ReconstructResult,
  StageResult,
  TelemetrySample,
} from "./types.ts";
import { PIPELINE_STAGES } from "./types.ts";
import { analyzeTelemetry } from "./ingestion.ts";
import { detectFast } from "./features.ts";
import { selectKeyframes, selectedFrames } from "./keyframes.ts";
import { maskDynamic } from "./masking.ts";
import { denseMvs, selectiveFill, sparseCloud } from "./mvs.ts";
import { coverageHistogram, densityEstimate, rangeGate, statisticalOutliers, voxelFuse } from "./fusion.ts";
import { buildMesh } from "./mesh.ts";
import { gpsAccuracyStatement, posesFromTelemetry } from "./georef.ts";
import { validateAgainstGt } from "./validation.ts";
import { captureSynthetic } from "./synthetic.ts";
import { laplacianVariance } from "./image.ts";
import { ENGINE_CONTRACT } from "./hooks.ts";
import { makeIdentitySim3 } from "./coords.ts";

export interface RunInput {
  config: ReconstructConfig;
  frames?: FrameBuffer[];
  telemetry?: TelemetrySample[];
  poses?: CameraPose[];
  useSynthetic?: boolean;
  gtPoints?: { x: number; y: number; z: number }[];
  origin?: ReconstructResult["origin"];
  K?: ReconstructResult["intrinsics"];
}

export interface RunProgress {
  stage: PipelineStage;
  frac: number;
  message: string;
}

export async function runPipeline(
  input: RunInput,
  onProgress?: (p: RunProgress) => void,
  onLog?: (line: string) => void,
): Promise<ReconstructResult> {
  const t0 = now();
  const logs: string[] = [];
  const stages: StageResult[] = [];
  const log = (line: string) => {
    logs.push(line);
    onLog?.(line);
  };
  const stage = async (
    id: PipelineStage,
    fn: () => Promise<Record<string, number | string | boolean>> | Record<string, number | string | boolean>,
  ) => {
    const startedAt = now();
    onProgress?.({ stage: id, frac: 0, message: PIPELINE_STAGES.find((s) => s.id === id)?.label ?? id });
    log(`→ ${id}`);
    try {
      const metrics = await fn();
      const finishedAt = now();
      stages.push({ stage: id, startedAt, finishedAt, ok: true, message: "ok", metrics });
      log(`✓ ${id} ${(finishedAt - startedAt).toFixed(0)}ms ${JSON.stringify(metrics)}`);
      onProgress?.({ stage: id, frac: 1, message: "done" });
      return metrics;
    } catch (err) {
      const finishedAt = now();
      const message = err instanceof Error ? err.message : String(err);
      stages.push({ stage: id, startedAt, finishedAt, ok: false, message, metrics: {} });
      log(`✗ ${id} ${message}`);
      throw err;
    }
  };

  let frames = input.frames;
  let telemetry = input.telemetry ?? [];
  let worldGt = input.gtPoints ?? null;
  let origin = input.origin;
  let K = input.K;
  let seedPoses = input.poses;

  await stage("01_ingestion", () => {
    if (input.useSynthetic || !frames?.length) {
      log("No video frames — generating single-pass synthetic capture (known geometry).");
      const cap = captureSynthetic(input.config.mode);
      frames = cap.frames;
      telemetry = cap.telemetry;
      seedPoses = cap.poses;
      worldGt = cap.world.gtPoints;
      origin = cap.origin;
      K = cap.K;
      log(`Synthetic ${frames.length} frames ${K.width}×${K.height}, GNSS ${telemetry[0]?.gnss}`);
    }
    if (!frames?.length) throw new Error("Ingestion produced no frames");
    if (!K) {
      const w = frames[0].width,
        h = frames[0].height;
      K = { fx: w * 0.9, fy: w * 0.9, cx: (w - 1) / 2, cy: (h - 1) / 2, width: w, height: h };
      log("Intrinsics missing — using pinhole fy≈0.9w. Scale of uncalibrated cameras is weakly constrained.");
    }
    for (const f of frames) {
      if (!f.blurScore) f.blurScore = laplacianVariance(f.rgba, f.width, f.height, 3);
    }
    const tel = analyzeTelemetry(telemetry, frames[frames.length - 1].timeS);
    origin = origin ?? telemetry.find((s) => s.lla)?.lla ?? { lat: 0, lon: 0, alt: 0 };
    return {
      frames: frames.length,
      telemetry: telemetry.length,
      gps: tel.gpsCount,
      imu: tel.imuCount,
      hz: Number(tel.hz.toFixed(2)),
      gnss: tel.gnss,
    };
  });

  frames = frames!;
  K = K!;
  origin = origin!;

  let keyRecords = await (async () => {
    const rec = selectKeyframes(frames!, telemetry, input.config.mode);
    await stage("02_keyframes", () => {
      const n = rec.filter((r) => r.selected).length;
      return { candidates: rec.length, selected: n };
    });
    return rec;
  })();

  const keys = selectedFrames(frames, keyRecords);
  for (const f of keys) {
    const kps = detectFast(f, 240, 2);
    f.featureCount = kps.length;
  }
  keyRecords = keyRecords.map((r) => {
    const f = keys.find((k) => k.index === r.frameIndex);
    return f ? { ...r, featureQuality: Math.min(1, f.featureCount / 300) } : r;
  });

  let poses: CameraPose[] = seedPoses?.filter((p) => keys.some((k) => k.index === p.frameIndex)) ?? [];
  if (poses.length !== keys.length) {
    const target = centroidOfKeys(keys, poses);
    const built = posesFromTelemetry(
      telemetry,
      keys.map((k) => ({ index: k.index, timeS: k.timeS })),
      origin,
      target,
    );
    poses = built.poses;
  }
  if (seedPoses && seedPoses.length) {
    const map = new Map(seedPoses.map((p) => [p.frameIndex, p]));
    poses = keys.map((k) => map.get(k.index)).filter((p): p is CameraPose => !!p);
  }

  await stage("03_masks", () => {
    const frac = maskDynamic(keys, poses, K!);
    return { dynamicFraction: Number(frac.toFixed(4)), engine: "motion-compensation (YOLO hook idle)" };
  });

  const sparse = sparseCloud(keys, poses, K);
  const meanReproj = sparse.length
    ? sparse.reduce((a, p) => a + p.reprojErrPx, 0) / sparse.length
    : 0;
  const tracks = sparse.length;

  await stage("04_sfm", () => {
    const registered = poses.filter((p) => p.registered).length;
    const ratio = poses.length ? registered / poses.length : 0;
    log(`SfM engine: in-browser GLOMAP-lite. ${ENGINE_CONTRACT.primarySfm} native hook idle.`);
    if (ratio < 0.6) log("Registered ratio < 0.6 — MASt3R-SfM would be invoked on a native worker.");
    log(`Sparse tracks triangulated: ${sparse.length}, mean reproj ${meanReproj.toFixed(3)} px`);
    for (const p of poses) {
      p.trackCount = keys.find((k) => k.index === p.frameIndex)?.featureCount ?? 0;
      p.reprojErrPx = meanReproj;
      p.source = input.config.hasGps ? "hybrid" : "sfm";
    }
    return {
      registeredRatio: Number(ratio.toFixed(3)),
      meanReprojPx: Number(meanReproj.toFixed(3)),
      tracks,
      engine: "inbrowser-glomap-lite",
    };
  });

  let dense = await (async () => {
    let cloud = sparse;
    await stage("05_dense", async () => {
      const extra = await denseMvs(keys, poses, K!, input.config.mode, (frac) =>
        onProgress?.({ stage: "05_dense", frac, message: `PatchMatch ${(frac * 100).toFixed(0)}%` }),
      );
      cloud = extra.concat(sparse);
      return { mvsPoints: extra.length, sparsePoints: sparse.length, backbone: "patchmatch-mvs" };
    });
    return cloud;
  })();

  await stage("06_ai_depth", () => {
    if (input.config.mode === "fast") {
      log("FAST mode: skipping selective depth fill.");
      return { added: 0, skipped: 1 };
    }
    const weak = keys[Math.floor(keys.length / 2)];
    const pose = poses.find((p) => p.frameIndex === weak.index);
    const ni = Math.min(keys.length - 1, keys.indexOf(weak) + 1);
    const fill = pose
      ? selectiveFill(weak, pose, keys[ni], poses.find((p) => p.frameIndex === keys[ni].index), K!, dense)
      : [];
    dense = dense.concat(fill);
    log(`Selective geometric fill added ${fill.length} pts (DAV2 ONNX hook idle).`);
    return { added: fill.length, skipped: 0 };
  });

  await stage("07_fusion", () => {
    const gated = rangeGate(dense, poses);
    log(`Range gate ${dense.length} → ${gated.length} (GPS-altitude envelope + front-of-camera).`);
    densityEstimate(gated);
    const cell = input.config.mode === "fast" ? 1.2 : input.config.mode === "accuracy" ? 0.65 : 0.9;
    let fused = voxelFuse(gated, cell);
    fused = statisticalOutliers(fused);
    dense = fused;
    const cov = coverageHistogram(dense);
    return {
      fused: dense.length,
      high: Number(cov.high.toFixed(3)),
      medium: Number(cov.medium.toFixed(3)),
      low: Number(cov.low.toFixed(3)),
    };
  });

  const mesh = await (async () => {
    const m = buildMesh(dense, input.config.mode === "accuracy" ? 0.85 : 1.15);
    await stage("08_mesh", () => ({
      vertices: m.vertexCount,
      triangles: m.triangleCount,
      method: "visibility-grid (Poisson analogue on HIGH cells)",
    }));
    return m;
  })();

  await stage("09_texture", () => {
    const sharp = keys.reduce((a, b) => a + b.sharpness, 0) / Math.max(1, keys.length);
    return { vertexColor: 1, meanSharpness: Number(sharp.toFixed(3)) };
  });

  const gnss = telemetry.find((s) => s.lla)?.gnss ?? "none";
  await stage("10_georef", () => {
    log(gpsAccuracyStatement(gnss));
    return {
      frame: "ENU",
      datum: "WGS84",
      gnss,
      cameras: poses.filter((p) => p.registered).length,
    };
  });

  const coverage = coverageHistogram(dense);
  const registeredRatio = poses.length ? poses.filter((p) => p.registered).length / poses.length : 0;
  const observedFraction = 1 - coverage.unobserved;
  const validation = await (async () => {
    const v = validateAgainstGt(
      dense,
      worldGt,
      registeredRatio,
      meanReproj,
      tracks,
      0,
      observedFraction,
    );
    await stage("11_validation", () => ({
      hasGt: v.hasIndependentGt,
      rmse3d: v.rmse3d ?? -1,
      completeness: Number(v.completeness.toFixed(3)),
    }));
    return v;
  })();

  const limitations: AccuracyLimitations = {
    gps: gpsAccuracyStatement(gnss),
    imu: input.config.hasImu
      ? "IMU used as attitude prior. Consumer IMU drift is not a substitute for SfM rotation."
      : "No IMU. Attitude from look-at / SfM only.",
    rtk: input.config.hasRtk
      ? "RTK/PPK high-accuracy mode enabled. Absolute error still needs a documented datum."
      : "RTK/PPK not provided. Do not claim ≤1 m absolute accuracy from standard GPS.",
    intrinsics: input.config.hasIntrinsics
      ? "User intrinsics applied."
      : "Intrinsics approximated from image size. Radial distortion unmodelled.",
    gcp: input.config.hasGcp
      ? "Checkpoints supplied — see validation RMSE."
      : "No independent GCPs. Absolute accuracy has not been independently established unless a synthetic GT scene was used.",
    engine: `In-browser CPU engine. Native ${ENGINE_CONTRACT.primarySfm} / ${ENGINE_CONTRACT.dense} not attached.`,
  };

  const elapsedMs = now() - t0;
  const gpsPts = poses.filter((p) => p.registered).map((p) => p.C);
  const result: ReconstructResult = {
    points: dense,
    mesh,
    cameras: poses,
    gpsTrajectory: {
      kind: "gps",
      points: gpsPts,
      times: poses.map((p) => p.timeS),
    },
    cameraTrajectory: {
      kind: "camera",
      points: poses.map((p) => p.C),
      times: poses.map((p) => p.timeS),
    },
    keyframes: keyRecords,
    intrinsics: K,
    origin,
    georef: {
      frame: "ENU",
      datum: "WGS84",
      sim3: { ...makeIdentitySim3(), rmse: 0 },
      gnssQuality: gnss,
    },
    validation,
    limitations,
    stages,
    coverage,
    stats: {
      frameCount: frames.length,
      keyframeCount: keys.length,
      registeredCount: poses.filter((p) => p.registered).length,
      pointCount: dense.length,
      triangleCount: mesh.triangleCount,
      maskedDynamicFrac:
        keys.reduce((a, f) => {
          if (!f.dynamicMask) return a;
          let d = 0;
          for (let i = 0; i < f.dynamicMask.length; i++) d += f.dynamicMask[i];
          return a + d / f.dynamicMask.length;
        }, 0) / Math.max(1, keys.length),
      elapsedMs,
      mode: input.config.mode,
      engine: "inbrowser-glomap-lite+patchmatch",
    },
    logs,
  };
  log(`Done in ${(elapsedMs / 1000).toFixed(2)}s · ${dense.length} pts · ${mesh.triangleCount} tris`);
  return result;
}

function centroidOfKeys(_keys: FrameBuffer[], poses: CameraPose[]) {
  if (!poses.length) return { x: 0, y: 0, z: 0 };
  let x = 0,
    y = 0,
    z = 0;
  for (const p of poses) {
    x += p.C.x;
    y += p.C.y;
    z += p.C.z;
  }
  const n = poses.length;
  return { x: x / n, y: y / n - 10, z: 1 };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
