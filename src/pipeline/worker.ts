import { runPipeline, type RunInput } from "./run.ts";
import type { ReconstructResult } from "./types.ts";

export type WorkerIn =
  | { type: "run"; input: RunInput }
  | { type: "cancel" };

export type WorkerOut =
  | { type: "progress"; stage: string; frac: number; message: string }
  | { type: "log"; line: string }
  | { type: "done"; result: ReconstructResult }
  | { type: "error"; message: string };

let cancelled = false;

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type !== "run") return;
  cancelled = false;
  try {
    const result = await runPipeline(
      msg.input,
      (p) => {
        if (cancelled) throw new Error("cancelled");
        post({ type: "progress", stage: p.stage, frac: p.frac, message: p.message });
      },
      (line) => post({ type: "log", line }),
    );
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

function post(msg: WorkerOut) {
  self.postMessage(msg);
}
