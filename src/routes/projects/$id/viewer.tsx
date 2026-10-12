import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SceneCanvas, type ViewerLayers } from "@/components/viewer/scene-canvas";
import { getProject, loadResult } from "@/lib/projects";
import type { ReconstructResult } from "@/pipeline/types";
import type { MeasureKind, MeasureResult } from "@/pipeline/measure";
import { cn, formatMeters } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id/viewer")({ component: ViewerPage });

function ViewerPage() {
  const { id } = Route.useParams();
  const [result, setResult] = useState<ReconstructResult | undefined>();
  const [layers, setLayers] = useState<ViewerLayers>({
    points: true,
    mesh: true,
    confidence: false,
    cameras: true,
    gps: false,
    grid: true,
  });
  const [kind, setKind] = useState<MeasureKind>("distance");
  const [measuring, setMeasuring] = useState(false);
  const [last, setLast] = useState<MeasureResult | null>(null);
  const [coord, setCoord] = useState("—");
  const project = getProject(id);

  useEffect(() => {
    void loadResult(id).then(setResult);
  }, [id]);

  if (!result) {
    return (
      <AppShell projectId={id}>
        <div className="p-8">
          <p className="text-sm text-muted">No reconstruction yet.</p>
          <Button className="mt-4" asChild>
            <Link to="/projects/$id/process" params={{ id }}>
              Run pipeline
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const toggle = (k: keyof ViewerLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <AppShell projectId={id}>
      <div className="flex h-[calc(100dvh-3rem)] flex-col md:h-dvh">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">{project?.name ?? "Model"}</p>
            <Badge tone="sage">{result.stats.mode}</Badge>
            <span className="font-mono text-[11px] text-muted">
              {result.stats.pointCount.toLocaleString()} pts · {result.stats.triangleCount.toLocaleString()} tris · ENU metres
            </span>
          </div>
          <p className="font-mono text-[11px] text-muted">{coord}</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative min-h-[52vh] min-w-0 flex-1 md:min-h-0">
            <SceneCanvas
              result={result}
              layers={layers}
              measureKind={kind}
              measuring={measuring}
              onMeasure={(r) => setLast(r)}
              onCoord={setCoord}
            />
          </div>
          <aside className="w-full shrink-0 overflow-y-auto border-t border-border p-4 md:w-72 md:border-t-0 md:border-l">
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted">LAYERS</p>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["points", "Point cloud"],
                  ["mesh", "Mesh"],
                  ["confidence", "Confidence overlay"],
                  ["cameras", "Camera trajectory"],
                  ["gps", "GPS trajectory"],
                  ["grid", "Grid"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex h-10 items-center justify-between gap-2 text-sm">
                  {label}
                  <Switch checked={layers[k]} onCheckedChange={() => toggle(k)} />
                </label>
              ))}
            </div>

            <p className="mt-6 font-mono text-[10px] tracking-[0.16em] text-muted">MEASURE</p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {(["distance", "horizontal", "vertical", "area", "volume"] as MeasureKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setMeasuring(true);
                    setLast(null);
                  }}
                  className={cn(
                    "h-9 rounded-md border text-[11px] capitalize",
                    measuring && kind === k ? "border-sage/50 bg-accent" : "border-border",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => {
                setMeasuring(false);
                setLast(null);
              }}
            >
              Stop measuring
            </Button>
            {last && last.valueM ? (
              <div className="mt-3 rounded-md border border-border bg-background p-3">
                <p className="font-mono text-sm tabular-nums">
                  {formatMeters(last.valueM)} {last.unit === "m" ? "" : last.unit}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{last.confidence}</p>
                {last.warning ? <p className="mt-2 text-[11px] text-conf-low">{last.warning}</p> : null}
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-muted">
                Click {kind === "area" || kind === "volume" ? "3+" : "2"} points on the model. Low-confidence hits warn instead of silent numbers.
              </p>
            )}

            <p className="mt-6 font-mono text-[10px] tracking-[0.16em] text-muted">CONFIDENCE</p>
            <ul className="mt-2 space-y-1 font-mono text-[11px]">
              <li className="flex justify-between text-conf-high">
                HIGH <span>{(result.coverage.high * 100).toFixed(0)}%</span>
              </li>
              <li className="flex justify-between text-conf-med">
                MEDIUM <span>{(result.coverage.medium * 100).toFixed(0)}%</span>
              </li>
              <li className="flex justify-between text-conf-low">
                LOW <span>{(result.coverage.low * 100).toFixed(0)}%</span>
              </li>
              <li className="flex justify-between text-conf-none">
                UNOBSERVED <span>{(result.coverage.unobserved * 100).toFixed(0)}%</span>
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Unobserved regions are holes, not invented façades.
            </p>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
