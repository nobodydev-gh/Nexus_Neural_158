import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StageRail } from "@/components/stage-rail";
import { getProject, loadResult, loadTelemetryText, loadVideo, saveResult, upsertProject, type Project } from "@/lib/projects";
import { defaultConfig, startProcessing, type ProcessHandle } from "@/lib/process-client";
import { parseTelemetry } from "@/pipeline/ingestion";
import { extractVideoFrames } from "@/pipeline/video";
import type { FrameBuffer } from "@/pipeline/types";
import { formatBytes, formatDuration } from "@/lib/utils";
import { PIPELINE_STAGES } from "@/pipeline/types";

export const Route = createFileRoute("/projects/$id/process")({ component: ProcessPage });

function ProcessPage() {
  const { id } = Route.useParams();
  const [project, setProject] = useState<Project | undefined>();
  const [logs, setLogs] = useState<string[]>([]);
  const [stage, setStage] = useState<string>("");
  const [frac, setFrac] = useState(0);
  const [message, setMessage] = useState("Idle");
  const [elapsed, setElapsed] = useState(0);
  const [heap, setHeap] = useState<number | undefined>();
  const [complete, setComplete] = useState(false);
  const handle = useRef<ProcessHandle | null>(null);
  const t0 = useRef<number>(0);
  const timer = useRef<number | null>(null);
  const running = useRef(false);

  const start = async (resume: boolean) => {
    const p = getProject(id);
    if (!p || running.current) return;
    running.current = true;
    if (resume) setLogs((l) => [...l, "Resume requested — rerunning remaining stages from current inputs."]);
    upsertProject({ ...p, status: "processing", error: undefined });
    setProject({ ...p, status: "processing" });
    setComplete(false);
    t0.current = performance.now();
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      setElapsed(performance.now() - t0.current);
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) setHeap(mem.usedJSHeapSize);
    }, 400);

    let frames: FrameBuffer[] | undefined;
    let telemetry;
    if (!p.inputs.synthetic) {
      const tel = await loadTelemetryText(id);
      if (tel) telemetry = parseTelemetry(tel.name, tel.text);
      const vid = await loadVideo(id);
      if (vid) {
        const maxWidth = p.mode === "fast" ? 192 : p.mode === "accuracy" ? 288 : 240;
        const targetFps = p.mode === "fast" ? 1.2 : p.mode === "accuracy" ? 2.4 : 1.8;
        const extracted = await extractVideoFrames(vid, {
          maxWidth,
          targetFps,
          maxFrames: p.mode === "fast" ? 16 : p.mode === "accuracy" ? 36 : 24,
          onProgress: (f) => {
            setMessage(`Extracting frames ${(f * 100).toFixed(0)}%`);
            setFrac(f * 0.15);
          },
        });
        frames = extracted.frames;
      }
    }

    const config = defaultConfig({
      mode: p.mode,
      hasGps: p.inputs.hasGps,
      hasImu: p.inputs.hasImu,
      hasRtk: p.inputs.hasRtk,
      hasPpk: p.inputs.hasPpk,
      hasBaro: p.inputs.hasBaro,
      hasIntrinsics: p.inputs.hasIntrinsics,
      hasGcp: p.inputs.hasGcp,
    });

    handle.current = startProcessing(
      { config, frames, telemetry, useSynthetic: p.inputs.synthetic || !frames?.length },
      {
        onProgress: (s, f, m) => {
          setStage(s);
          setFrac((PIPELINE_STAGES.findIndex((x) => x.id === s) + f) / PIPELINE_STAGES.length);
          setMessage(m);
          const cur = getProject(id);
          if (cur) upsertProject({ ...cur, stage: s, progress: f, status: "processing" });
        },
        onLog: (line) => setLogs((ls) => [...ls.slice(-200), line]),
        onDone: (result) => {
          running.current = false;
          void saveResult(id, result).then(() => {
            setComplete(true);
            setFrac(1);
            setMessage("Complete");
            setProject(getProject(id));
          });
          if (timer.current) window.clearInterval(timer.current);
        },
        onError: (errMessage) => {
          running.current = false;
          setMessage(errMessage);
          const cur = getProject(id);
          if (cur) upsertProject({ ...cur, status: "failed", error: errMessage });
          setProject(getProject(id));
          if (timer.current) window.clearInterval(timer.current);
        },
      },
    );
  };

  useEffect(() => {
    let alive = true;
    setProject(getProject(id));
    void loadResult(id).then((r) => {
      if (!alive) return;
      if (r) {
        setComplete(true);
        setLogs(r.logs);
        setStage("11_validation");
        setFrac(1);
        setMessage("Complete");
        return;
      }
      const p = getProject(id);
      if (p && p.status !== "processing") {
        void start(p.status === "paused" || p.status === "failed");
      }
    });
    return () => {
      alive = false;
      running.current = false;
      handle.current?.cancel();
      if (timer.current) window.clearInterval(timer.current);
    };
    // start is stable enough for this id-scoped effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const cancel = () => {
    handle.current?.cancel();
    running.current = false;
    const p = getProject(id);
    if (p) upsertProject({ ...p, status: "paused" });
    setProject(getProject(id));
    setMessage("Cancelled");
  };

  if (!project) {
    return (
      <AppShell>
        <div className="p-8 text-sm text-muted">Job not found.</div>
      </AppShell>
    );
  }

  const pct = Math.round(frac * 100);
  const stageIdx = PIPELINE_STAGES.findIndex((x) => x.id === stage);
  const done = new Set(
    PIPELINE_STAGES.filter((_, i) => (complete ? true : i < stageIdx)).map((s) => s.id),
  );

  return (
    <AppShell projectId={id}>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted">PROCESSING</p>
            <h1 className="mt-2 text-2xl font-medium">{project.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="sage">{project.mode}</Badge>
            <Badge>{project.status}</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Stat label="Stage" value={stage ? stage.replace(/^\d+_/, "") : "idle"} />
          <Stat label="Elapsed" value={formatDuration(elapsed || project.elapsedMs || 0)} />
          <Stat label="JS heap" value={heap ? formatBytes(heap) : "n/a"} />
          <Stat label="Progress" value={`${pct}%`} />
        </div>
        <Progress value={pct} className="mt-4" />
        <p className="mt-2 text-sm text-muted">{message}</p>
        <p className="mt-1 font-mono text-[11px] text-muted">
          CPU: browser tab · GPU/VRAM: WebGL viewer only · native COLMAP hook idle
        </p>

        <div className="mt-8">
          <StageRail current={stage} done={done} />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {project.status !== "processing" && !complete ? (
            <Button onClick={() => void start(false)}>Start reconstruction</Button>
          ) : null}
          {project.status === "processing" ? (
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : null}
          {(project.status === "failed" || project.status === "paused") && !complete ? (
            <Button onClick={() => void start(true)}>Resume</Button>
          ) : null}
          {complete ? (
            <Button asChild>
              <Link to="/projects/$id/viewer" params={{ id }}>
                Open 3D viewer
              </Link>
            </Button>
          ) : null}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Log</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto font-mono text-[11px] leading-relaxed text-muted">
              {logs.length ? logs.join("\n") : "Waiting to start…"}
            </pre>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}
