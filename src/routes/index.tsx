import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, Box, Clock, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StageRail } from "@/components/stage-rail";
import { createProject, listProjects } from "@/lib/projects";
import { formatDuration } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const projects = useMemo(() => listProjects(), [tick]);

  const startSample = (mode: "fast" | "balanced" | "accuracy") => {
    const p = createProject({
      name: `Sample site · ${mode}`,
      mode,
      status: "validated",
      inputs: {
        synthetic: true,
        hasGps: true,
        hasImu: true,
        hasRtk: false,
        hasPpk: false,
        hasBaro: true,
        hasIntrinsics: true,
        hasGcp: true,
        videoName: "synthetic-single-pass.mp4",
        telemetryName: "synthetic.srt",
      },
    });
    setTick((n) => n + 1);
    void navigate({ to: "/projects/$id/process", params: { id: p.id } });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[11px] tracking-[0.2em] text-sage">SIH 2026 · PS 26158 · NTRO</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-medium tracking-tight sm:text-5xl">
          Single-pass drone video, georeferenced 3D, with observability.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          TERRASPLAT reconstructs metric geometry from one UAV pass. Dense MVS is the backbone.
          Confidence is computed per point and applied to fusion and measurements — not just a colour overlay.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={() => startSample("balanced")}>
            Reconstruct sample site
            <ArrowRight />
          </Button>
          <Button variant="outline" asChild>
            <Link to="/new">
              <Plus />
              New reconstruction
            </Link>
          </Button>
        </div>

        <div className="mt-12">
          <p className="mb-3 font-mono text-[11px] tracking-[0.16em] text-muted">PIPELINE</p>
          <StageRail />
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <Fact k="Geometry backbone" v="PatchMatch MVS" d="Not monocular depth, not 3DGS." />
          <Fact k="Georeference" v="WGS84 · ENU" d="Standalone GPS is not ≤1 m. RTK/PPK is the high-accuracy path." />
          <Fact k="Engine here" v="In-browser CPU" d="GLOMAP / COLMAP / OpenMVS attach via the documented local hook." />
        </div>

        <section className="mt-14">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-sm font-medium tracking-wide">Jobs</h2>
            <span className="font-mono text-[11px] text-muted">{projects.length} stored locally</span>
          </div>
          {projects.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No reconstructions yet</CardTitle>
                <CardDescription>
                  Run the sample site (synthetic single-pass with known ground truth) or upload a drone video and DJI SRT.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="grid gap-3">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={p.status === "complete" ? "/projects/$id/viewer" : "/projects/$id/process"}
                    params={{ id: p.id }}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm">{p.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                        <Badge tone="sage">{p.mode}</Badge>
                        <Badge>{p.status}</Badge>
                        {p.statsPreview ? (
                          <span>
                            {p.statsPreview.points.toLocaleString()} pts · {p.statsPreview.triangles.toLocaleString()} tris
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-muted">
                      {p.elapsedMs ? (
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <Clock className="size-3.5" />
                          {formatDuration(p.elapsedMs)}
                        </span>
                      ) : null}
                      <Box className="size-4" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Fact({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <Card>
      <CardHeader>
        <p className="font-mono text-[10px] tracking-[0.16em] text-muted">{k}</p>
        <CardTitle className="text-base">{v}</CardTitle>
        <CardDescription>{d}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
