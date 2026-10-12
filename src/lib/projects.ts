import { uid } from "./utils";
import { idbDel, idbGet, idbSet } from "./idb";
import type { ProcessingMode, ReconstructResult } from "@/pipeline/types";

export type ProjectStatus = "draft" | "validated" | "processing" | "paused" | "failed" | "complete";

export interface ProjectInputs {
  videoName?: string;
  telemetryName?: string;
  videoSize?: number;
  telemetrySize?: number;
  hasGps: boolean;
  hasImu: boolean;
  hasRtk: boolean;
  hasPpk: boolean;
  hasBaro: boolean;
  hasIntrinsics: boolean;
  hasGcp: boolean;
  knownDimensionM?: number;
  synthetic: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  mode: ProcessingMode;
  status: ProjectStatus;
  inputs: ProjectInputs;
  stage?: string;
  progress?: number;
  error?: string;
  elapsedMs?: number;
  statsPreview?: {
    points: number;
    triangles: number;
    keyframes: number;
    rmse3d?: number;
  };
}

const LS = "terrasplat.projects.v1";

export function listProjects(): Project[] {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

function saveList(xs: Project[]) {
  localStorage.setItem(LS, JSON.stringify(xs));
}

export function upsertProject(p: Project) {
  const xs = listProjects();
  const i = xs.findIndex((x) => x.id === p.id);
  const next = { ...p, updatedAt: Date.now() };
  if (i >= 0) xs[i] = next;
  else xs.unshift(next);
  saveList(xs);
  return next;
}

export function getProject(id: string): Project | undefined {
  return listProjects().find((p) => p.id === id);
}

export function deleteProject(id: string) {
  saveList(listProjects().filter((p) => p.id !== id));
  void idbDel(`result:${id}`);
  void idbDel(`video:${id}`);
  void idbDel(`tel:${id}`);
}

export function createProject(partial: Partial<Project> & { name: string; mode: ProcessingMode }): Project {
  const p: Project = {
    id: uid("ts"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "draft",
    inputs: {
      hasGps: false,
      hasImu: false,
      hasRtk: false,
      hasPpk: false,
      hasBaro: false,
      hasIntrinsics: false,
      hasGcp: false,
      synthetic: false,
    },
    ...partial,
    name: partial.name,
    mode: partial.mode,
  };
  return upsertProject(p);
}

export async function saveResult(id: string, result: ReconstructResult) {
  await idbSet(`result:${id}`, result);
  const p = getProject(id);
  if (p) {
    upsertProject({
      ...p,
      status: "complete",
      elapsedMs: result.stats.elapsedMs,
      statsPreview: {
        points: result.stats.pointCount,
        triangles: result.stats.triangleCount,
        keyframes: result.stats.keyframeCount,
        rmse3d: result.validation.rmse3d,
      },
    });
  }
}

export async function loadResult(id: string): Promise<ReconstructResult | undefined> {
  return idbGet<ReconstructResult>(`result:${id}`);
}

export async function saveVideo(id: string, blob: Blob) {
  await idbSet(`video:${id}`, blob);
}
export async function loadVideo(id: string): Promise<Blob | undefined> {
  return idbGet<Blob>(`video:${id}`);
}
export async function saveTelemetryText(id: string, text: string, name: string) {
  await idbSet(`tel:${id}`, { text, name });
}
export async function loadTelemetryText(id: string): Promise<{ text: string; name: string } | undefined> {
  return idbGet(`tel:${id}`);
}
