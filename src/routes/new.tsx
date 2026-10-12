import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { createProject, saveTelemetryText, saveVideo } from "@/lib/projects";
import { parseTelemetry, analyzeTelemetry } from "@/pipeline/ingestion";
import type { ProcessingMode } from "@/pipeline/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/new")({ component: NewJob });

function NewJob() {
  const navigate = useNavigate();
  const [name, setName] = useState("Site survey");
  const [mode, setMode] = useState<ProcessingMode>("balanced");
  const [video, setVideo] = useState<File | null>(null);
  const [telFile, setTelFile] = useState<File | null>(null);
  const [telText, setTelText] = useState<string>("");
  const [telNote, setTelNote] = useState<string>("");
  const [hasRtk, setHasRtk] = useState(false);
  const [hasPpk, setHasPpk] = useState(false);
  const [hasIntrinsics, setHasIntrinsics] = useState(false);
  const [hasGcp, setHasGcp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onTel = async (f: File) => {
    setTelFile(f);
    const text = await f.text();
    setTelText(text);
    try {
      const samples = parseTelemetry(f.name, text);
      const a = analyzeTelemetry(samples);
      setTelNote(
        `${samples.length} samples · ${a.hz.toFixed(1)} Hz · GPS ${a.gpsCount} · IMU ${a.imuCount} · GNSS ${a.gnss}`,
      );
      setErr(null);
    } catch (e) {
      setTelNote("");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async (synthetic: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const parsed = !synthetic && telText ? parseTelemetry(telFile?.name ?? "tel.csv", telText) : [];
      const a = parsed.length ? analyzeTelemetry(parsed) : null;
      const p = createProject({
        name: synthetic ? `${name} (sample)` : name,
        mode,
        status: "draft",
        inputs: {
          synthetic,
          videoName: synthetic ? "synthetic-single-pass.mp4" : video?.name,
          telemetryName: synthetic ? "synthetic.srt" : telFile?.name,
          videoSize: video?.size,
          telemetrySize: telFile?.size,
          hasGps: synthetic || (a ? a.gpsCount > 0 : false),
          hasImu: synthetic || (a ? a.imuCount > 0 : false),
          hasRtk,
          hasPpk,
          hasBaro: synthetic,
          hasIntrinsics: synthetic || hasIntrinsics,
          hasGcp: synthetic || hasGcp,
        },
      });
      if (video) await saveVideo(p.id, video);
      if (telText && telFile) await saveTelemetryText(p.id, telText, telFile.name);
      await navigate({ to: "/projects/$id/validate", params: { id: p.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">NEW RECONSTRUCTION</p>
        <h1 className="mt-2 text-2xl font-medium">Inputs</h1>
        <p className="mt-2 text-sm text-muted">
          Video is required for a field job. Telemetry (DJI SRT, CSV, GPX, JSON) is required for georeferencing.
          Missing optionals adapt the pipeline and are listed as limitations.
        </p>

        <div className="mt-8 space-y-6">
          <Field label="Job name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div>
            <Label>Processing mode</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["fast", "balanced", "accuracy"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left text-sm",
                    mode === m ? "border-sage/50 bg-accent" : "border-border bg-card",
                  )}
                >
                  <span className="font-medium capitalize">{m}</span>
                  <span className="mt-1 block text-[11px] text-muted">
                    {m === "fast" ? "Fewer frames, no AI fill" : m === "accuracy" ? "Denser MVS + fill" : "Adaptive + selective fill"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Drone video</CardTitle>
              <CardDescription>MP4, MOV, AVI, MKV. Processed on-device — never uploaded to a cloud API.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="file"
                accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,.mp4,.mov,.avi,.mkv"
                onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
              />
              {video ? (
                <p className="mt-2 font-mono text-[11px] text-muted">
                  {video.name} · {(video.size / 1e6).toFixed(1)} MB
                </p>
              ) : (
                <p className="mt-2 text-[12px] text-muted">Optional if you run the built-in sample scene.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Telemetry</CardTitle>
              <CardDescription>DJI SRT, CSV, GPX, or JSON. GPS / IMU / RTK fields are detected automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="file"
                accept=".srt,.csv,.gpx,.json,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onTel(f);
                }}
              />
              {telNote ? <p className="mt-2 font-mono text-[11px] text-sage">{telNote}</p> : null}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow label="RTK present" checked={hasRtk} onChange={setHasRtk} hint="High-accuracy GNSS mode" />
            <ToggleRow label="PPK present" checked={hasPpk} onChange={setHasPpk} hint="Post-processed kinematic" />
            <ToggleRow label="Camera intrinsics file" checked={hasIntrinsics} onChange={setHasIntrinsics} hint="Otherwise pinhole is approximated" />
            <ToggleRow label="Ground-truth checkpoints" checked={hasGcp} onChange={setHasGcp} hint="Enables independent RMSE" />
          </div>

          {err ? <p className="text-sm text-conf-low">{err}</p> : null}

          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void submit(false)}>
              Validate inputs
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void submit(true)}>
              Use sample scene instead
            </Button>
            <Badge tone="sage">{mode}</Badge>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-[11px] text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
