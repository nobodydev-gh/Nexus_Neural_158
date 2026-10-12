/**
 * External photogrammetry engine hook.
 *
 * In-browser TERRASPLAT implements the same data contract with a CPU
 * GLOMAP-lite + PatchMatch MVS engine. On a machine with native binaries,
 * point `engine` at a local worker that speaks this protocol:
 *
 *   POST {base}/sfm      { images: [{id, png|jpeg}], gps?, imu?, intrinsics? }
 *        → { cameras: CameraPose[], points: sparse ply bytes, tracks, reproj }
 *
 *   POST {base}/mvs      { cameras, images, masks? }
 *        → { points: dense ply bytes }
 *
 *   Expected binaries (documented, not bundled):
 *     - GLOMAP  (primary SfM)
 *     - COLMAP  (mapper / MVS fallback)
 *     - OpenMVS (dense + mesh)
 *     - MASt3R-SfM (only for regions with registered_ratio < 0.6)
 *     - Depth Anything V2 ONNX (weak MVS cells only)
 *     - YOLO11-seg + ByteTrack (dynamic masks)
 *
 * The in-browser engine never calls a cloud API.
 */

export interface ExternalEngineConfig {
  baseUrl: string;
  /** Shared secret header if the local worker requires it. */
  token?: string;
}

export interface SparseSfmRequest {
  imageIds: number[];
  /** width/height of the working resolution. */
  width: number;
  height: number;
  gps?: { id: number; lat: number; lon: number; alt: number }[];
  imu?: { id: number; yaw: number; pitch: number; roll: number }[];
  intrinsics?: { fx: number; fy: number; cx: number; cy: number };
}

export interface SparseSfmResponse {
  engine: "glomap" | "colmap" | "mast3r" | "inbrowser";
  registeredRatio: number;
  meanReprojPx: number;
  trackCount: number;
  cameras: {
    id: number;
    C: [number, number, number];
    R: number[];
    registered: boolean;
  }[];
}

export function glomapHealthy(resp: SparseSfmResponse): boolean {
  return resp.registeredRatio >= 0.6 && resp.meanReprojPx <= 1.8 && resp.trackCount >= 80;
}

export function shouldFallbackMast3r(resp: SparseSfmResponse): boolean {
  return !glomapHealthy(resp);
}

export async function callExternalSfm(
  cfg: ExternalEngineConfig,
  body: SparseSfmRequest,
): Promise<SparseSfmResponse | null> {
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/sfm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as SparseSfmResponse;
  } catch {
    return null;
  }
}

export const ENGINE_CONTRACT = {
  primarySfm: "GLOMAP",
  fallbackSfm: "MASt3R-SfM (weak regions only)",
  dense: "COLMAP / OpenMVS PatchMatch — never 3DGS as metric backbone",
  aiDepth: "Depth Anything V2, scale-aligned to MVS, weak cells only",
  masks: "YOLO-seg + ByteTrack → people, vehicles, animals",
} as const;
