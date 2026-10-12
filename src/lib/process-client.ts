import type { ReconstructConfig, ReconstructResult } from "@/pipeline/types";
import type { RunInput } from "@/pipeline/run";
import type { WorkerIn, WorkerOut } from "@/pipeline/worker";

export interface ProcessHandle {
  cancel: () => void;
}

export function startProcessing(
  input: RunInput,
  handlers: {
    onProgress: (stage: string, frac: number, message: string) => void;
    onLog: (line: string) => void;
    onDone: (result: ReconstructResult) => void;
    onError: (message: string) => void;
  },
): ProcessHandle {
  let worker: Worker | null = null;
  let cancelled = false;
  try {
    worker = new Worker(new URL("../pipeline/worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const msg = ev.data;
      if (msg.type === "progress") handlers.onProgress(msg.stage, msg.frac, msg.message);
      else if (msg.type === "log") handlers.onLog(msg.line);
      else if (msg.type === "done") handlers.onDone(msg.result);
      else if (msg.type === "error") handlers.onError(msg.message);
    };
    worker.onerror = (e) => {
      handlers.onError(e.message || "Worker failed");
    };
    worker.postMessage({ type: "run", input } satisfies WorkerIn);
  } catch {
    void import("@/pipeline/run").then(({ runPipeline }) => {
      if (cancelled) return;
      runPipeline(
        input,
        (p) => handlers.onProgress(p.stage, p.frac, p.message),
        handlers.onLog,
      )
        .then(handlers.onDone)
        .catch((err: unknown) => handlers.onError(err instanceof Error ? err.message : String(err)));
    });
  }
  return {
    cancel: () => {
      cancelled = true;
      worker?.postMessage({ type: "cancel" } satisfies WorkerIn);
      worker?.terminate();
    },
  };
}

export function defaultConfig(partial: Partial<ReconstructConfig> & Pick<ReconstructConfig, "mode">): ReconstructConfig {
  return {
    hasGps: false,
    hasImu: false,
    hasRtk: false,
    hasPpk: false,
    hasBaro: false,
    hasIntrinsics: false,
    hasGcp: false,
    engine: "inbrowser",
    ...partial,
  };
}
