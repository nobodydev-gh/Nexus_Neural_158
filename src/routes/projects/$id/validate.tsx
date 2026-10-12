import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getProject, loadTelemetryText, upsertProject, type Project } from "@/lib/projects";
import { analyzeTelemetry, parseTelemetry } from "@/pipeline/ingestion";
import { gpsAccuracyStatement } from "@/pipeline/georef";

export const Route = createFileRoute("/projects/$id/validate")({ component: ValidatePage });

function ValidatePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | undefined>();
  const [report, setReport] = useState<string[]>([]);

  useEffect(() => {
    const p = getProject(id);
    setProject(p);
    void (async () => {
      const lines: string[] = [];
      if (!p) return;
      if (p.inputs.synthetic) {
        lines.push("Synthetic single-pass capture will be generated at process time.");
        lines.push("Independent ground truth is available (known building 16×10×7 m + terrain).");
        lines.push("GNSS quality: standalone (intentionally not RTK). Absolute claim ≤1 m is disabled.");
        lines.push("Intrinsics known from the virtual camera.");
      } else {
        if (!p.inputs.videoName) lines.push("No video — pipeline will refuse unless you switch to the sample scene.");
        else lines.push(`Video: ${p.inputs.videoName}`);
        const tel = await loadTelemetryText(id);
        if (!tel) {
          lines.push("No telemetry file. Georeferencing will be unavailable; reconstruction stays in a local frame.");
        } else {
          try {
            const samples = parseTelemetry(tel.name, tel.text);
            const a = analyzeTelemetry(samples);
            lines.push(`Telemetry: ${samples.length} samples at ${a.hz.toFixed(2)} Hz.`);
            lines.push(`GPS points ${a.gpsCount} · IMU ${a.imuCount} · coverage ${(a.coverage * 100).toFixed(0)}%.`);
            lines.push(gpsAccuracyStatement(a.gnss));
            if (a.gaps.length) lines.push(`${a.gaps.length} telemetry gap(s) > 1.5 s.`);
          } catch (e) {
            lines.push(`Telemetry parse failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (!p.inputs.hasIntrinsics) lines.push("Intrinsics missing — pinhole approximated from frame size.");
        if (!p.inputs.hasGcp) lines.push("No GCPs — absolute accuracy will not be independently established.");
        if (!p.inputs.hasRtk && !p.inputs.hasPpk) lines.push("RTK/PPK absent — high-accuracy GNSS mode off.");
      }
      setReport(lines);
    })();
  }, [id]);

  if (!project) {
    return (
      <AppShell>
        <div className="p-8 text-sm text-muted">Job not found.</div>
      </AppShell>
    );
  }

  const proceed = () => {
    upsertProject({ ...project, status: "validated" });
    void navigate({ to: "/projects/$id/process", params: { id } });
  };

  return (
    <AppShell projectId={id}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">INPUT VALIDATION</p>
        <h1 className="mt-2 text-2xl font-medium">{project.name}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="sage">{project.mode}</Badge>
          <Badge>{project.status}</Badge>
          {project.inputs.synthetic ? <Badge tone="high">synthetic GT</Badge> : null}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>What the pipeline can and cannot claim</CardTitle>
            <CardDescription>
              Optional sensors are dropped automatically. Limitations are recorded on the accuracy report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm leading-relaxed">
              {report.map((l) => (
                <li key={l} className="border-l-2 border-border pl-3 text-muted">
                  {l}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={proceed}>Continue to processing</Button>
          <Button variant="outline" asChild>
            <Link to="/new">Back</Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
