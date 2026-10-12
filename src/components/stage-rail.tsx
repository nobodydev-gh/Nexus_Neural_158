import { PIPELINE_STAGES, type PipelineStage } from "@/pipeline/types";
import { cn } from "@/lib/utils";

export function StageRail({ current, done }: { current?: string; done?: Set<string> }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {PIPELINE_STAGES.map((s, i) => {
        const active = current === s.id;
        const finished = done?.has(s.id);
        return (
          <li
            key={s.id}
            className={cn(
              "rounded-lg border px-3 py-2.5",
              active ? "border-sage/50 bg-accent" : "border-border bg-card",
            )}
          >
            <p className="font-mono text-[10px] tracking-[0.14em] text-muted">{String(i + 1).padStart(2, "0")}</p>
            <p className="mt-1 text-sm">{s.label}</p>
            <p className="text-[11px] text-muted">{s.hint}</p>
            {finished ? <p className="mt-1 font-mono text-[10px] text-conf-high">DONE</p> : null}
            {active && !finished ? <p className="mt-1 font-mono text-[10px] text-sage">LIVE</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function stageIndex(id?: PipelineStage | string): number {
  return PIPELINE_STAGES.findIndex((s) => s.id === id);
}
