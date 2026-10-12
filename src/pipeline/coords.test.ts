import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySim3,
  ecefToLla,
  enuFrame,
  llaToEcef,
  llaToEnu,
  sim3Rmse,
  umeyamaSim3,
} from "./coords.ts";
import type { Vec3 } from "./types.ts";

describe("geodesy", () => {
  it("round-trips WGS84 LLA through ECEF", () => {
    const lla = { lat: 28.6139, lon: 77.209, alt: 216 };
    const back = ecefToLla(llaToEcef(lla));
    assert.ok(Math.abs(back.lat - lla.lat) < 1e-8);
    assert.ok(Math.abs(back.lon - lla.lon) < 1e-8);
    assert.ok(Math.abs(back.alt - lla.alt) < 1e-3);
  });

  it("ENU origin is zero", () => {
    const origin = { lat: 12.97, lon: 77.59, alt: 900 };
    const f = enuFrame(origin);
    const p = llaToEnu(origin, f);
    assert.ok(Math.hypot(p.x, p.y, p.z) < 1e-6);
  });

  it("1e-5 deg latitude is ~1.11 m north", () => {
    const origin = { lat: 0, lon: 0, alt: 0 };
    const f = enuFrame(origin);
    const p = llaToEnu({ lat: 0.00001, lon: 0, alt: 0 }, f);
    assert.ok(Math.abs(p.y - 1.1132) < 0.05);
    assert.ok(Math.abs(p.x) < 0.05);
  });
});

describe("Sim(3) Umeyama", () => {
  it("recovers known scale, rotation, translation", () => {
    const src: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 3 },
      { x: 1, y: 1, z: 1 },
    ];
    const s = 2.5;
    const R = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const t = { x: 10, y: -4, z: 7 };
    const dst = src.map((p) => applySim3(p, { s, R, t }));
    const est = umeyamaSim3(src, dst);
    assert.ok(Math.abs(est.s - s) < 1e-4);
    assert.ok(sim3Rmse(src, dst, est) < 1e-3);
  });
});
