export type ProcessingMode = "fast" | "balanced" | "accuracy";

export type ConfidenceClass = "high" | "medium" | "low" | "unobserved";

export type PipelineStage =
  | "01_ingestion"
  | "02_keyframes"
  | "03_masks"
  | "04_sfm"
  | "05_dense"
  | "06_ai_depth"
  | "07_fusion"
  | "08_mesh"
  | "09_texture"
  | "10_georef"
  | "11_validation";

export const PIPELINE_STAGES: { id: PipelineStage; label: string; hint: string }[] = [
  { id: "01_ingestion", label: "Ingestion", hint: "Video + telemetry sync" },
  { id: "02_keyframes", label: "Keyframes", hint: "Adaptive selection" },
  { id: "03_masks", label: "Masking", hint: "Dynamic objects" },
  { id: "04_sfm", label: "SfM", hint: "GLOMAP-lite poses" },
  { id: "05_dense", label: "Dense MVS", hint: "PatchMatch stereo" },
  { id: "06_ai_depth", label: "AI depth", hint: "Weak-region fill" },
  { id: "07_fusion", label: "Fusion", hint: "Confidence-weighted" },
  { id: "08_mesh", label: "Mesh", hint: "Visibility-aware" },
  { id: "09_texture", label: "Texture", hint: "Sharp-view projection" },
  { id: "10_georef", label: "Georef", hint: "Sim(3) / ENU" },
  { id: "11_validation", label: "Validation", hint: "Accuracy report" },
];

export type GnssQuality = "none" | "standalone" | "dgps" | "rtk_float" | "rtk_fixed" | "ppk";

export interface Lla {
  lat: number;
  lon: number;
  alt: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TelemetrySample {
  timeS: number;
  frame?: number;
  lla?: Lla;
  /** Attitude in degrees: yaw/heading, pitch, roll (aircraft or gimbal). */
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  /** Gimbal-specific if present. */
  gimbalYawDeg?: number;
  gimbalPitchDeg?: number;
  gimbalRollDeg?: number;
  relAltM?: number;
  iso?: number;
  shutterS?: number;
  fnum?: number;
  gnss: GnssQuality;
  source: "srt" | "csv" | "gpx" | "json" | "synthetic";
  raw?: string;
}

export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  k1?: number;
  k2?: number;
  p1?: number;
  p2?: number;
}

export interface CameraPose {
  frameIndex: number;
  timeS: number;
  /** World-from-camera rotation, row-major 3x3, ENU meters. */
  R: number[];
  /** Camera center in ENU meters. */
  C: Vec3;
  registered: boolean;
  reprojErrPx: number;
  trackCount: number;
  source: "gps_imu" | "sfm" | "hybrid" | "glomap" | "colmap";
}

export interface FrameBuffer {
  index: number;
  timeS: number;
  width: number;
  height: number;
  /** RGBA packed, length width*height*4. */
  rgba: Uint8ClampedArray;
  /** Optional motion/dynamic mask, 1 = dynamic. */
  dynamicMask?: Uint8Array;
  blurScore: number;
  featureCount: number;
  sharpness: number;
}

export interface KeyframeRecord {
  frameIndex: number;
  timeS: number;
  blurScore: number;
  featureQuality: number;
  motionPx: number;
  spatialM: number;
  overlap: number;
  parallaxDeg: number;
  sceneChange: number;
  selected: boolean;
  reasons: string[];
}

export interface PointRecord {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  observations: number;
  angleDiversityDeg: number;
  reprojErrPx: number;
  depthConsistency: number;
  density: number;
  imageQuality: number;
  dynamicProb: number;
  visibility: number;
  confidence: number;
  klass: ConfidenceClass;
  source: "mvs" | "sfm" | "ai_depth" | "fused";
}

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  uvs: Float32Array;
  confidence: Float32Array;
  triangleCount: number;
  vertexCount: number;
}

export interface Trajectory {
  kind: "camera" | "gps";
  points: Vec3[];
  times: number[];
}

export interface ValidationReport {
  hasIndependentGt: boolean;
  disclaimer: string;
  rmseX?: number;
  rmseY?: number;
  rmseZ?: number;
  rmse3d?: number;
  medianError?: number;
  p95Error?: number;
  measurementError?: number;
  completeness: number;
  observedFraction: number;
  cameraTrajectoryRmse?: number;
  georefRmse?: number;
  meanReprojPx: number;
  registeredRatio: number;
  trackCount: number;
  noteReprojVsWorld: string;
}

export interface AccuracyLimitations {
  gps: string;
  imu: string;
  rtk: string;
  intrinsics: string;
  gcp: string;
  engine: string;
}

export interface ReconstructConfig {
  mode: ProcessingMode;
  hasGps: boolean;
  hasImu: boolean;
  hasRtk: boolean;
  hasPpk: boolean;
  hasBaro: boolean;
  hasIntrinsics: boolean;
  hasGcp: boolean;
  knownDimensionM?: number;
  origin?: Lla;
  engine: "inbrowser" | "glomap" | "colmap";
}

export interface ResourceSnapshot {
  jsHeapUsed?: number;
  jsHeapTotal?: number;
  estimatedGpuBytes: number;
  cpuWorkers: number;
}

export interface StageResult {
  stage: PipelineStage;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  message: string;
  metrics: Record<string, number | string | boolean>;
}

export interface ReconstructResult {
  points: PointRecord[];
  mesh: MeshData;
  cameras: CameraPose[];
  gpsTrajectory: Trajectory;
  cameraTrajectory: Trajectory;
  keyframes: KeyframeRecord[];
  intrinsics: CameraIntrinsics;
  origin: Lla;
  georef: {
    frame: "ENU";
    datum: "WGS84";
    sim3: { s: number; R: number[]; t: Vec3; rmse: number };
    gnssQuality: GnssQuality;
  };
  validation: ValidationReport;
  limitations: AccuracyLimitations;
  stages: StageResult[];
  coverage: Record<ConfidenceClass, number>;
  stats: {
    frameCount: number;
    keyframeCount: number;
    registeredCount: number;
    pointCount: number;
    triangleCount: number;
    maskedDynamicFrac: number;
    elapsedMs: number;
    mode: ProcessingMode;
    engine: string;
  };
  logs: string[];
  textureJpeg?: string;
}

export interface GcpPoint {
  id: string;
  lla: Lla;
  enu?: Vec3;
  pixel?: { frameIndex: number; u: number; v: number };
}

export const CONFIDENCE_LABEL: Record<ConfidenceClass, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  unobserved: "UNOBSERVED",
};
