import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getProject, loadResult } from "@/lib/projects";
import type { ReconstructResult } from "@/pipeline/types";
import { formatMeters } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id/accuracy")({ component: AccuracyPage });

function AccuracyPage() {
  const { id } = Route.useParams();
  const [result, setResult] = useState<ReconstructResult | undefined>();
  const project = getProject(id);
  useEffect(() => {
    void loadResult(id).then(setResult);
  }, [id]);

  if (!result) {
    return (
      <AppShell projectId={id}>
        <div className="p-8 text-sm text-muted">
          Run the pipeline first.{" "}
          <Link className="text-sage" to="/projects/$id/process" params={{ id }}>
            Process
          </Link>
        </div>
      </AppShell>
    );
  }
  const v = result.validation;
  return (
    <AppShell projectId={id}>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">ACCURACY · VALIDATION</p>
        <h1 className="mt-2 text-2xl font-medium">{project?.name}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={v.hasIndependentGt ? "high" : "med"}>
            {v.hasIndependentGt ? "independent GT" : "no independent GT"}
          </Badge>
          <Badge>{result.georef.gnssQuality}</Badge>
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Disclaimer</CardTitle>
            <CardDescription>{v.disclaimer}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted">{v.noteReprojVsWorld}</CardContent>
        </Card>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric k="X RMSE" v={v.rmseX} />
          <Metric k="Y RMSE" v={v.rmseY} />
          <Metric k="Z RMSE" v={v.rmseZ} />
          <Metric k="3D RMSE" v={v.rmse3d} />
          <Metric k="Median" v={v.medianError} />
          <Metric k="P95" v={v.p95Error} />
          <Metric k="Georef RMSE" v={v.georefRmse} />
          <Metric k="Traj. RMSE" v={v.cameraTrajectoryRmse} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric k="Completeness" v={v.completeness} unit="" digits={3} raw />
          <Metric k="Registered frames" v={v.registeredRatio} unit="" digits={3} raw />
          <Metric k="Mean reproj" v={v.meanReprojPx} unit="px" digits={3} raw />
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Limitations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted">
            <p>{result.limitations.gps}</p>
            <p>{result.limitations.rtk}</p>
            <p>{result.limitations.imu}</p>
            <p>{result.limitations.intrinsics}</p>
            <p>{result.limitations.gcp}</p>
            <p>{result.limitations.engine}</p>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-3 overflow-hidden rounded-full">
              <span className="bg-conf-high" style={{ width: `${result.coverage.high * 100}%` }} />
              <span className="bg-conf-med" style={{ width: `${result.coverage.medium * 100}%` }} />
              <span className="bg-conf-low" style={{ width: `${result.coverage.low * 100}%` }} />
              <span className="bg-conf-none" style={{ width: `${result.coverage.unobserved * 100}%` }} />
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">
              HIGH {(result.coverage.high * 100).toFixed(0)}% · MED {(result.coverage.medium * 100).toFixed(0)}% · LOW{" "}
              {(result.coverage.low * 100).toFixed(0)}% · UNOBS {(result.coverage.unobserved * 100).toFixed(0)}%
            </p>
          </CardContent>
        </Card>

        <Button className="mt-8" variant="outline" asChild>
          <Link to="/projects/$id/export" params={{ id }}>
            Export reports
          </Link>
        </Button>
      </div>
    </AppShell>
  );
}

function Metric({
  k,
  v,
  unit = "m",
  digits = 3,
  raw,
}: {
  k: string;
  v?: number;
  unit?: string;
  digits?: number;
  raw?: boolean;
}) {
  let text = "—";
  if (v != null && Number.isFinite(v)) {
    text = raw ? `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}` : formatMeters(v, digits);
  }
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted">{k}</p>
      <p className="mt-1 font-mono text-sm tabular-nums">{text}</p>
    </div>
  );
}
