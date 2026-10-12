import type { ConfidenceClass, MeshData, PointRecord, Vec3 } from "./types.ts";

export type MeasureKind = "distance" | "horizontal" | "vertical" | "area" | "volume";

export interface MeasureRequest {
  kind: MeasureKind;
  points: Vec3[];
}

export interface MeasureResult {
  kind: MeasureKind;
  valueM: number;
  unit: string;
  warning?: string;
  confidence: ConfidenceClass;
  breakdown?: Record<string, number>;
}

function klassOf(p: Vec3, cloud: PointRecord[], mesh: MeshData | null): ConfidenceClass {
  let best = Infinity;
  let k: ConfidenceClass = "unobserved";
  for (const q of cloud) {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
    if (d < best) {
      best = d;
      k = q.klass;
    }
  }
  if (mesh && mesh.vertexCount) {
    for (let i = 0; i < mesh.vertexCount; i++) {
      const dx = mesh.positions[i * 3] - p.x;
      const dy = mesh.positions[i * 3 + 1] - p.y;
      const dz = mesh.positions[i * 3 + 2] - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) {
        best = d;
        const c = mesh.confidence[i] ?? 0;
        k = c >= 0.72 ? "high" : c >= 0.42 ? "medium" : c > 0.12 ? "low" : "unobserved";
      }
    }
  }
  if (best > 9) return "unobserved";
  return k;
}

const rank: ConfidenceClass[] = ["high", "medium", "low", "unobserved"];

function worst(ks: ConfidenceClass[]): ConfidenceClass {
  let w: ConfidenceClass = "high";
  for (const k of ks) if (rank.indexOf(k) > rank.indexOf(w)) w = k;
  return w;
}

function warn(k: ConfidenceClass): string | undefined {
  if (k === "unobserved")
    return "Measurement touches unobserved geometry. Do not treat this value as a survey measurement.";
  if (k === "low")
    return "Measurement touches LOW-confidence geometry (weak viewpoint diversity or residual). Treat as indicative only.";
  return undefined;
}

export function measure(req: MeasureRequest, cloud: PointRecord[], mesh: MeshData | null): MeasureResult {
  const ks = req.points.map((p) => klassOf(p, cloud, mesh));
  const confidence = worst(ks);
  const warning = warn(confidence);
  if (req.kind === "distance") {
    const [a, b] = req.points;
    const valueM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    return {
      kind: "distance",
      valueM,
      unit: "m",
      warning,
      confidence,
      breakdown: {
        dx: b.x - a.x,
        dy: b.y - a.y,
        dz: b.z - a.z,
        horizontal: Math.hypot(b.x - a.x, b.y - a.y),
        vertical: b.z - a.z,
      },
    };
  }
  if (req.kind === "horizontal") {
    const [a, b] = req.points;
    const valueM = Math.hypot(b.x - a.x, b.y - a.y);
    return { kind: "horizontal", valueM, unit: "m", warning, confidence };
  }
  if (req.kind === "vertical") {
    const [a, b] = req.points;
    const valueM = b.z - a.z;
    return { kind: "vertical", valueM, unit: "m", warning, confidence };
  }
  if (req.kind === "area") {
    const valueM = polygonArea(req.points);
    return { kind: "area", valueM, unit: "m²", warning, confidence };
  }
  // volume: prism = horizontal area * mean height above min z
  const area = polygonArea(req.points);
  const zs = req.points.map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMean = zs.reduce((a, b) => a + b, 0) / zs.length;
  const valueM = area * Math.abs(zMean - zMin);
  return {
    kind: "volume",
    valueM,
    unit: "m³",
    warning:
      warning ??
      "Volume is a prism approximation (horizontal polygon × mean height). Not a solid-body integral.",
    confidence,
    breakdown: { area, meanHeight: zMean - zMin },
  };
}

export function polygonArea(pts: Vec3[]): number {
  if (pts.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    acc += a.x * b.y - b.x * a.y;
  }
  return Math.abs(acc) / 2;
}
