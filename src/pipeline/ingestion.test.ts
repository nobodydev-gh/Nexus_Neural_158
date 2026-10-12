import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTelemetry, parseCsvTelemetry, parseGpx, parseJsonTelemetry, parseSrt, sampleAt } from "./ingestion.ts";

describe("SRT parsing", () => {
  it("parses DJI bracket tags", () => {
    const srt = `1
00:00:00,000 --> 00:00:00,033
[latitude: 28.6139] [longitude: 77.2090] [rel_alt: 80.5] [abs_alt: 296.2] [gb_yaw: 12.3] [gb_pitch: -45.0] [gb_roll: 0.1]
`;
    const samples = parseSrt(srt);
    assert.equal(samples.length, 1);
    assert.ok(samples[0].lla);
    assert.equal(samples[0].lla!.lat, 28.6139);
    assert.equal(samples[0].lla!.lon, 77.209);
    assert.equal(samples[0].relAltM, 80.5);
    assert.equal(samples[0].gimbalPitchDeg, -45);
    assert.equal(samples[0].gnss, "standalone");
  });

  it("interpolates telemetry", () => {
    const text = `1
00:00:00,000 --> 00:00:00,040
[latitude: 28.6139000] [longitude: 77.2090000] [rel_alt: 28.00] [abs_alt: 244.00] [gb_yaw: 10.00] [gb_pitch: -48.00] [gb_roll: 0.00]

2
00:00:01,000 --> 00:00:01,040
[latitude: 28.6149000] [longitude: 77.2090000] [rel_alt: 30.00] [abs_alt: 246.00] [gb_yaw: 20.00] [gb_pitch: -48.00] [gb_roll: 0.00]
`;
    const parsed = parseSrt(text);
    assert.equal(parsed.length, 2);
    const a = analyzeTelemetry(parsed, 1);
    assert.ok(a.gpsCount === 2);
    assert.ok(a.hz > 0);
    const mid = sampleAt(parsed, 0.5);
    assert.ok(mid?.lla);
    assert.ok(Math.abs(mid!.lla!.lat - 28.6144) < 1e-6);
  });

  it("flags RTK fixed", () => {
    const srt = `1
00:00:00,000 --> 00:00:00,033
latitude: 1.0 longitude: 2.0 abs_alt: 10 rtk_fixed
`;
    assert.equal(parseSrt(srt)[0].gnss, "rtk_fixed");
  });
});

describe("CSV / GPX / JSON", () => {
  it("parses CSV headers", () => {
    const csv = `lat,lon,alt,time,yaw,pitch,roll,fix
28.6,77.2,220,0,10,-40,0,standalone
28.6001,77.2002,221,0.2,11,-41,0.1,rtk_fixed
`;
    const s = parseCsvTelemetry(csv);
    assert.equal(s.length, 2);
    assert.equal(s[1].gnss, "rtk_fixed");
  });

  it("parses GPX trkpt", () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
<trkpt lat="28.6" lon="77.2"><ele>210</ele><time>2026-01-01T00:00:00Z</time></trkpt>
<trkpt lat="28.601" lon="77.201"><ele>211</ele><time>2026-01-01T00:00:02Z</time></trkpt>
</trkseg></trk></gpx>`;
    const s = parseGpx(gpx);
    assert.equal(s.length, 2);
    assert.equal(s[0].timeS, 0);
    assert.ok(s[1].timeS > 0);
  });

  it("parses JSON array", () => {
    const s = parseJsonTelemetry(JSON.stringify([{ lat: 1, lon: 2, alt: 3, timeS: 0, yaw: 10 }]));
    assert.equal(s.length, 1);
    assert.equal(s[0].lla?.lat, 1);
  });
});
