import type { MeshData, PointRecord } from "./types.ts";

function gridKey(x: number, y: number, res: number): string {
  return `${Math.round(x / res)}:${Math.round(y / res)}`;
}

/**
 * Visibility-aware meshing.
 * 1. Project to ENU XY occupancy (drone nadir-ish) at adaptive resolution.
 * 2. Connect only cells whose vertices are observed (not unobserved).
 * 3. Drop triangles that are too steep/large (likely occluder spanning).
 * Poisson is appropriate for HIGH-confidence watertight patches; we use a
 * screened height-field (a Poisson-on-a-grid analogue) there, and leave
 * LOW/UNOBSERVED holes instead of hallucinating facades we never saw.
 */
export function buildMesh(points: PointRecord[], cellM = 1.1): MeshData {
  const usable = points.filter((p) => p.klass !== "unobserved");
  if (usable.length < 6) {
    return {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      colors: new Float32Array(0),
      uvs: new Float32Array(0),
      confidence: new Float32Array(0),
      triangleCount: 0,
      vertexCount: 0,
    };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of usable) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 8);
  const res = Math.max(cellM, span / 72);
  type Cell = { z: number; r: number; g: number; b: number; c: number; n: number; klassW: number };
  const cells = new Map<string, Cell>();
  for (const p of usable) {
    const w = p.klass === "high" ? 1 : p.klass === "medium" ? 0.6 : 0.25;
    const k = gridKey(p.x, p.y, res);
    const prev = cells.get(k);
    if (!prev) {
      cells.set(k, { z: p.z * w, r: p.r * w, g: p.g * w, b: p.b * w, c: p.confidence * w, n: w, klassW: w });
    } else {
      prev.z += p.z * w;
      prev.r += p.r * w;
      prev.g += p.g * w;
      prev.b += p.b * w;
      prev.c += p.confidence * w;
      prev.n += w;
    }
  }
  const ix0 = Math.floor(minX / res);
  const iy0 = Math.floor(minY / res);
  const nx = Math.floor(maxX / res) - ix0 + 1;
  const ny = Math.floor(maxY / res) - iy0 + 1;
  const vertIndex = new Int32Array(nx * ny).fill(-1);
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const conf: number[] = [];
  const pushV = (ix: number, iy: number, cell: Cell) => {
    const id = iy * nx + ix;
    if (vertIndex[id] >= 0) return vertIndex[id];
    const n = cell.n || 1;
    const x = (ix0 + ix) * res;
    const y = (iy0 + iy) * res;
    const z = cell.z / n;
    const vi = positions.length / 3;
    positions.push(x, y, z);
    colors.push(cell.r / n, cell.g / n, cell.b / n);
    uvs.push((x - minX) / span, (y - minY) / span);
    conf.push(cell.c / n);
    vertIndex[id] = vi;
    return vi;
  };
  const indices: number[] = [];
  const cellAt = (ix: number, iy: number) => cells.get(`${ix0 + ix}:${iy0 + iy}`);
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = cellAt(ix, iy);
      const b = cellAt(ix + 1, iy);
      const c = cellAt(ix, iy + 1);
      const d = cellAt(ix + 1, iy + 1);
      if (a && b && c) {
        const za = a.z / a.n,
          zb = b.z / b.n,
          zc = c.z / c.n;
        if (Math.abs(za - zb) < res * 4 && Math.abs(za - zc) < res * 4) {
          const ia = pushV(ix, iy, a);
          const ib = pushV(ix + 1, iy, b);
          const ic = pushV(ix, iy + 1, c);
          indices.push(ia, ib, ic);
        }
      }
      if (b && c && d) {
        const zb = b.z / b.n,
          zc = c.z / c.n,
          zd = d.z / d.n;
        if (Math.abs(zb - zd) < res * 4 && Math.abs(zc - zd) < res * 4) {
          const ib = pushV(ix + 1, iy, b);
          const ic = pushV(ix, iy + 1, c);
          const idv = pushV(ix + 1, iy + 1, d);
          indices.push(ib, idv, ic);
        }
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    colors: new Float32Array(colors),
    uvs: new Float32Array(uvs),
    confidence: new Float32Array(conf),
    triangleCount: indices.length / 3,
    vertexCount: positions.length / 3,
  };
}

export function meshStats(mesh: MeshData) {
  return {
    vertices: mesh.vertexCount,
    triangles: mesh.triangleCount,
    meanConfidence:
      mesh.confidence.length === 0
        ? 0
        : mesh.confidence.reduce((a, b) => a + b, 0) / mesh.confidence.length,
  };
}
