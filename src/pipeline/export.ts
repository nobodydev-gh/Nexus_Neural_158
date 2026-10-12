import type { CameraPose, MeshData, PointRecord, ReconstructResult } from "./types.ts";
import { CONFIDENCE_LABEL } from "./types.ts";

function klassByte(k: PointRecord["klass"]): number {
  return k === "high" ? 3 : k === "medium" ? 2 : k === "low" ? 1 : 0;
}

export function toPly(points: PointRecord[], withConfidence = false): string {
  const header = `ply
format ascii 1.0
element vertex ${points.length}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float confidence
property uchar klass
end_header
`;
  const body = points
    .map((p) => {
      const r = Math.round(Math.max(0, Math.min(255, p.r * 255)));
      const g = Math.round(Math.max(0, Math.min(255, p.g * 255)));
      const b = Math.round(Math.max(0, Math.min(255, p.b * 255)));
      return `${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)} ${r} ${g} ${b} ${p.confidence.toFixed(4)} ${klassByte(p.klass)}`;
    })
    .join("\n");
  void withConfidence;
  return header + body + "\n";
}

export function toConfidencePly(points: PointRecord[]): string {
  const colored = points.map((p) => {
    const c =
      p.klass === "high"
        ? [93, 154, 122]
        : p.klass === "medium"
          ? [196, 161, 90]
          : p.klass === "low"
            ? [196, 122, 90]
            : [92, 101, 96];
    return { ...p, r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
  });
  return toPly(colored, true);
}

export function toObj(mesh: MeshData): { obj: string; mtl: string } {
  const mtl = `newmtl terrasplat
Kd 0.82 0.84 0.80
d 1.0
`;
  let obj = `mtllib mesh.mtl
usemtl terrasplat
`;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    obj += `v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}\n`;
    obj += `vt ${mesh.uvs[i * 2]?.toFixed(5) ?? 0} ${mesh.uvs[i * 2 + 1]?.toFixed(5) ?? 0}\n`;
  }
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = mesh.indices[t * 3] + 1;
    const b = mesh.indices[t * 3 + 1] + 1;
    const c = mesh.indices[t * 3 + 2] + 1;
    obj += `f ${a}/${a} ${b}/${b} ${c}/${c}\n`;
  }
  return { obj, mtl };
}

/** LAS 1.2 point format 2 (XYZ + RGB), little-endian. */
export function toLas(points: PointRecord[]): ArrayBuffer {
  const headerSize = 227;
  const recordLen = 26;
  const n = points.length;
  const buf = new ArrayBuffer(headerSize + n * recordLen);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const magic = [0x4c, 0x41, 0x53, 0x46]; // LASF
  u8.set(magic, 0);
  dv.setUint8(24, 1); // ver major
  dv.setUint8(25, 2);
  const sys = "TERRASPLAT";
  for (let i = 0; i < sys.length; i++) u8[26 + i] = sys.charCodeAt(i);
  dv.setUint16(94, headerSize, true);
  dv.setUint32(96, headerSize, true);
  dv.setUint8(104, 2); // point format 2
  dv.setUint16(105, recordLen, true);
  dv.setUint32(107, n, true);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const scale = 0.001;
  dv.setFloat64(131, scale, true);
  dv.setFloat64(139, scale, true);
  dv.setFloat64(147, scale, true);
  dv.setFloat64(155, 0, true);
  dv.setFloat64(163, 0, true);
  dv.setFloat64(171, 0, true);
  dv.setFloat64(179, maxX, true);
  dv.setFloat64(187, minX, true);
  dv.setFloat64(195, maxY, true);
  dv.setFloat64(203, minY, true);
  dv.setFloat64(211, maxZ, true);
  dv.setFloat64(219, minZ, true);
  let o = headerSize;
  for (const p of points) {
    dv.setInt32(o, Math.round(p.x / scale), true);
    dv.setInt32(o + 4, Math.round(p.y / scale), true);
    dv.setInt32(o + 8, Math.round(p.z / scale), true);
    dv.setUint16(o + 12, Math.round(p.confidence * 65535), true);
    u8[o + 14] = 0;
    u8[o + 15] = klassByte(p.klass);
    dv.setUint8(o + 16, 0);
    dv.setInt8(o + 17, 0);
    dv.setUint16(o + 18, 0, true);
    dv.setUint16(o + 20, Math.round(p.r * 65535), true);
    dv.setUint16(o + 22, Math.round(p.g * 65535), true);
    dv.setUint16(o + 24, Math.round(p.b * 65535), true);
    o += recordLen;
  }
  return buf;
}

export function camerasJson(cameras: CameraPose[], origin: ReconstructResult["origin"]) {
  return {
    datum: "WGS84",
    frame: "local ENU meters",
    origin,
    cameras: cameras.map((c) => ({
      frameIndex: c.frameIndex,
      timeS: c.timeS,
      center_enu: c.C,
      R_world_from_camera: c.R,
      registered: c.registered,
      source: c.source,
      reprojection_error_px: c.reprojErrPx,
      tracks: c.trackCount,
    })),
  };
}

export function metadataJson(result: ReconstructResult) {
  return {
    name: "TERRASPLAT",
    version: "0.1.0",
    mode: result.stats.mode,
    engine: result.stats.engine,
    origin: result.origin,
    georef: result.georef,
    stats: result.stats,
    coverage: result.coverage,
    limitations: result.limitations,
    stages: result.stages,
  };
}

export function validationJson(result: ReconstructResult) {
  return result.validation;
}

export function accuracyReportHtml(result: ReconstructResult): string {
  const v = result.validation;
  const row = (k: string, val: string) =>
    `<tr><th>${k}</th><td>${val}</td></tr>`;
  const fmt = (n?: number, u = "m") => (n == null ? "—" : `${n.toFixed(3)} ${u}`);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>TERRASPLAT accuracy report</title>
<style>
  body{font:14px/1.5 IBM Plex Sans,system-ui,sans-serif;background:#090b0a;color:#e6ebe7;margin:0;padding:32px}
  h1{font-weight:500;letter-spacing:.12em;font-size:13px;text-transform:uppercase;color:#9db8a8}
  table{border-collapse:collapse;width:min(720px,100%)}
  th{text-align:left;color:#8b958e;font-weight:500;padding:8px 12px 8px 0}
  td{padding:8px 0;font-variant-numeric:tabular-nums}
  .note{max-width:720px;color:#8b958e;margin-top:24px}
</style></head><body>
<h1>TERRASPLAT · Accuracy</h1>
<p>${v.disclaimer}</p>
<table>
${row("Independent ground truth", v.hasIndependentGt ? "yes" : "no")}
${row("X RMSE", fmt(v.rmseX))}
${row("Y RMSE", fmt(v.rmseY))}
${row("Z RMSE", fmt(v.rmseZ))}
${row("3D RMSE", fmt(v.rmse3d))}
${row("Median error", fmt(v.medianError))}
${row("95th percentile", fmt(v.p95Error))}
${row("Completeness", v.completeness.toFixed(3))}
${row("Registered frames", v.registeredRatio.toFixed(3))}
${row("Mean reprojection", `${v.meanReprojPx.toFixed(3)} px`)}
${row("Georeferencing RMSE", fmt(v.georefRmse))}
</table>
<p class="note">${v.noteReprojVsWorld}</p>
<p class="note">GNSS: ${result.limitations.gps}</p>
</body></html>`;
}

export function processingReportHtml(result: ReconstructResult): string {
  const rows = result.stages
    .map(
      (s) =>
        `<tr><td>${s.stage}</td><td>${s.ok ? "ok" : "fail"}</td><td>${((s.finishedAt - s.startedAt) / 1000).toFixed(2)}s</td><td>${s.message}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>TERRASPLAT processing report</title>
<style>
  body{font:14px/1.5 IBM Plex Sans,system-ui,sans-serif;background:#090b0a;color:#e6ebe7;margin:0;padding:32px}
  h1{font-weight:500;letter-spacing:.12em;font-size:13px;text-transform:uppercase;color:#9db8a8}
  table{border-collapse:collapse;width:min(900px,100%)}
  td,th{border-bottom:1px solid #232a26;padding:8px 10px;text-align:left;font-variant-numeric:tabular-nums}
  th{color:#8b958e;font-weight:500}
</style></head><body>
<h1>TERRASPLAT · Processing</h1>
<p>Mode ${result.stats.mode} · engine ${result.stats.engine} · ${(result.stats.elapsedMs / 1000).toFixed(1)}s · ${result.stats.pointCount} points · ${result.stats.triangleCount} triangles</p>
<table><thead><tr><th>Stage</th><th>Status</th><th>Time</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
<pre style="color:#8b958e;white-space:pre-wrap">${result.logs.join("\n")}</pre>
</body></html>`;
}

export { CONFIDENCE_LABEL };
