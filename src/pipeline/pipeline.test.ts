import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyConfidence, scorePoint, finalizePoint, rangeGate } from "./fusion.ts";
import { measure, polygonArea } from "./measure.ts";
import { toPly, toLas, toObj } from "./export.ts";
import { selectKeyframes } from "./keyframes.ts";
import { glomapHealthy, shouldFallbackMast3r } from "./hooks.ts";
import { validateAgainstGt } from "./validation.ts";
import { runPipeline } from "./run.ts";
import type { CameraPose, FrameBuffer, PointRecord } from "./types.ts";

function frame(index: number, timeS: number, blur: number): FrameBuffer {
  const width = 32;
  const height = 24;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const n = (i * 17 + index * 13) % 255;
    rgba[i] = n;
    rgba[i + 1] = (n * 3) % 255;
    rgba[i + 2] = 80;
    rgba[i + 3] = 255;
  }
  return { index, timeS, width, height, rgba, blurScore: blur, featureCount: 40, sharpness: blur / 100 };
}

describe("confidence", () => {
  it("classifies HIGH / LOW / UNOBSERVED", () => {
    assert.equal(classifyConfidence(0.9, 4), "high");
    assert.equal(classifyConfidence(0.5, 2), "medium");
    assert.equal(classifyConfidence(0.2, 1), "low");
    assert.equal(classifyConfidence(0.05, 0), "unobserved");
  });

  it("penalises dynamics and poor reprojection", () => {
    const good = scorePoint({
      observations: 5,
      angleDiversityDeg: 40,
      reprojErrPx: 0.4,
      depthConsistency: 0.9,
      density: 0.8,
      imageQuality: 0.9,
      dynamicProb: 0,
      visibility: 1,
    });
    const bad = scorePoint({
      observations: 1,
      angleDiversityDeg: 2,
      reprojErrPx: 6,
      depthConsistency: 0.2,
      density: 0.1,
      imageQuality: 0.2,
      dynamicProb: 0.9,
      visibility: 0.2,
    });
    assert.ok(good > 0.7);
    assert.ok(bad < 0.35);
  });

  it("range-gates points behind the camera strip", () => {
    const poses: CameraPose[] = [
      {
        frameIndex: 0,
        timeS: 0,
        // +Y forward, +Z up — a nadir-oblique strip
        R: [1, 0, 0, 0, 0, 1, 0, 1, 0],
        C: { x: 0, y: -20, z: 30 },
        registered: true,
        reprojErrPx: 0,
        trackCount: 0,
        source: "gps_imu",
      },
    ];
    const keep = finalizePoint({
      x: 0, y: 10, z: 2, r: 1, g: 1, b: 1,
      observations: 3, angleDiversityDeg: 20, reprojErrPx: 0.5, depthConsistency: 0.8,
      density: 0.5, imageQuality: 0.8, dynamicProb: 0, visibility: 1, source: "mvs",
    });
    const drop = finalizePoint({
      x: 0, y: 0, z: -400, r: 1, g: 1, b: 1,
      observations: 2, angleDiversityDeg: 5, reprojErrPx: 3, depthConsistency: 0.2,
      density: 0.1, imageQuality: 0.2, dynamicProb: 0, visibility: 0.2, source: "mvs",
    });
    const out = rangeGate([keep, drop], poses);
    assert.ok(out.some((p) => p.z === 2));
    assert.ok(!out.some((p) => p.z < -100));
  });
});

describe("measurement", () => {
  it("computes 3-4-5 distance and warns on unobserved", () => {
    const cloud: PointRecord[] = [
      finalizePoint({
        x: 0, y: 0, z: 0, r: 1, g: 1, b: 1,
        observations: 4, angleDiversityDeg: 30, reprojErrPx: 0.4, depthConsistency: 0.9,
        density: 0.8, imageQuality: 0.9, dynamicProb: 0, visibility: 1, source: "mvs",
      }),
      finalizePoint({
        x: 3, y: 4, z: 0, r: 1, g: 1, b: 1,
        observations: 4, angleDiversityDeg: 30, reprojErrPx: 0.4, depthConsistency: 0.9,
        density: 0.8, imageQuality: 0.9, dynamicProb: 0, visibility: 1, source: "mvs",
      }),
    ];
    const d = measure({ kind: "distance", points: [cloud[0], cloud[1]] }, cloud, null);
    assert.ok(Math.abs(d.valueM - 5) < 1e-9);
    assert.equal(d.confidence, "high");
    const far = measure(
      { kind: "distance", points: [{ x: 99, y: 99, z: 99 }, { x: 100, y: 100, z: 100 }] },
      cloud,
      null,
    );
    assert.ok(far.warning);
    assert.equal(far.confidence, "unobserved");
  });

  it("shoelace area", () => {
    assert.equal(polygonArea([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]), 12);
  });
});

describe("exports", () => {
  it("writes PLY / OBJ / LAS", () => {
    const p = finalizePoint({
      x: 1, y: 2, z: 3, r: 0.2, g: 0.4, b: 0.6,
      observations: 3, angleDiversityDeg: 20, reprojErrPx: 0.5, depthConsistency: 0.8,
      density: 0.5, imageQuality: 0.7, dynamicProb: 0, visibility: 1, source: "mvs",
    });
    const ply = toPly([p]);
    assert.ok(ply.startsWith("ply"));
    assert.ok(ply.includes("element vertex 1"));
    const { obj } = toObj({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      confidence: new Float32Array([0.8, 0.8, 0.8]),
      triangleCount: 1,
      vertexCount: 3,
    });
    assert.ok(obj.includes("f 1/1 2/2 3/3"));
    const las = toLas([p]);
    const magic = new TextDecoder().decode(new Uint8Array(las).slice(0, 4));
    assert.equal(magic, "LASF");
  });
});

describe("keyframes", () => {
  it("does not pick every frame and keeps endpoints", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, i * 0.5, 40));
    const tel = frames.map((f, i) => ({
      timeS: f.timeS,
      lla: { lat: 28.6, lon: 77.2 + i * 0.00008, alt: 250 },
      gnss: "standalone" as const,
      source: "csv" as const,
    }));
    const rec = selectKeyframes(frames, tel, "fast");
    const sel = rec.filter((r) => r.selected);
    assert.ok(sel.length >= 2);
    assert.ok(sel.length < frames.length);
    assert.equal(sel[0].frameIndex, 0);
    assert.ok(rec.some((r) => r.reasons.includes("spatial") || r.reasons.includes("parallax") || r.reasons.includes("scene")));
  });
});

describe("validation + hooks", () => {
  it("refuses to treat reprojection as world accuracy without GT", () => {
    const v = validateAgainstGt([], null, 0.9, 0.4, 100, undefined, 0.5);
    assert.equal(v.hasIndependentGt, false);
    assert.ok(/not been independently established/i.test(v.disclaimer));
    assert.ok(/not real-world accuracy/i.test(v.noteReprojVsWorld));
  });

  it("GLOMAP health gate", () => {
    assert.equal(glomapHealthy({ engine: "glomap", registeredRatio: 0.8, meanReprojPx: 0.9, trackCount: 200, cameras: [] }), true);
    assert.equal(shouldFallbackMast3r({ engine: "glomap", registeredRatio: 0.4, meanReprojPx: 3, trackCount: 10, cameras: [] }), true);
  });
});

describe("end-to-end synthetic reconstruction", () => {
  it("produces a georeferenced cloud and mesh with independent GT", async () => {
    const r = await runPipeline({
      config: {
        mode: "fast",
        hasGps: true,
        hasImu: true,
        hasRtk: false,
        hasPpk: false,
        hasBaro: true,
        hasIntrinsics: true,
        hasGcp: true,
        engine: "inbrowser",
      },
      useSynthetic: true,
    });
    assert.ok(r.stats.pointCount > 80, `points ${r.stats.pointCount}`);
    assert.ok(r.stats.triangleCount > 8, `tris ${r.stats.triangleCount}`);
    assert.equal(r.stats.registeredCount, r.stats.keyframeCount);
    assert.equal(r.validation.hasIndependentGt, true);
    assert.ok(r.validation.rmse3d != null && r.validation.rmse3d < 25);
    assert.ok(r.georef.datum === "WGS84");
    assert.ok(r.limitations.gps.includes("≤1 m") || r.limitations.gps.includes("2–5 m"));
    assert.ok(r.stages.every((s) => s.ok));
    assert.ok(r.coverage.high + r.coverage.medium + r.coverage.low + r.coverage.unobserved > 0.99);
  });
});
