import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ENGINE_CONTRACT } from "@/pipeline/hooks";
import { PIPELINE_STAGES } from "@/pipeline/types";

export const Route = createFileRoute("/docs")({ component: DocsPage });

function DocsPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-sage">DOCUMENTATION</p>
        <h1 className="mt-2 text-3xl font-medium">TERRASPLAT</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Observability-aware reconstruction from a single UAV pass. Target problem: SIH 2026 PS 26158
          (NTRO) — georeferenced, measurable 3D from one drone video instead of a multi-pass mapping flight.
        </p>

        <h2 className="mt-10 text-lg font-medium">Architecture</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The product UI runs entirely in the browser. Frame extraction, adaptive keyframes, GLOMAP-lite pose
          init from GNSS/IMU, FAST/BRIEF tracks, PatchMatch multi-view stereo, visibility-aware meshing,
          Sim(3) georeferencing, and validation all execute on-device. After models are present there is no
          mandatory cloud API.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Native GLOMAP, COLMAP, OpenMVS, YOLO, and Depth Anything V2 attach through a local HTTP worker that
          implements the same JSON contract as the in-browser engine (<code className="text-sage">src/pipeline/hooks.ts</code>
          ). If that worker is absent, the CPU engine still produces a real, georeferenced model and states
          the limitation.
        </p>

        <h2 className="mt-10 text-lg font-medium">Pipeline</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted">
          {PIPELINE_STAGES.map((s) => (
            <li key={s.id}>
              <span className="font-mono text-sage">{s.id}</span> — {s.label}. {s.hint}.
            </li>
          ))}
        </ol>

        <h2 className="mt-10 text-lg font-medium">Algorithms</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
          <li>
            <strong className="text-foreground">Keyframes</strong> — blur (Laplacian variance), FAST quality,
            motion residual, GNSS displacement, FOV overlap, parallax, histogram scene-change. Not a fixed 3 m
            sampler.
          </li>
          <li>
            <strong className="text-foreground">SfM</strong> — {ENGINE_CONTRACT.primarySfm} is primary. Here:
            GNSS/IMU pose init + FAST/BRIEF + linear triangulation. Fallback {ENGINE_CONTRACT.fallbackSfm} when
            registered ratio below 0.6.
          </li>
          <li>
            <strong className="text-foreground">Dense</strong> — {ENGINE_CONTRACT.dense}. In-browser PatchMatch
            photoconsistency along known rays.
          </li>
          <li>
            <strong className="text-foreground">AI depth</strong> — {ENGINE_CONTRACT.aiDepth}. Selective fill is
            geometric and marked LOW if photoconsistency is weak. Unobserved stays unobserved.
          </li>
          <li>
            <strong className="text-foreground">Masks</strong> — {ENGINE_CONTRACT.masks}. In-browser: ego-motion
            compensated residual.
          </li>
          <li>
            <strong className="text-foreground">Confidence</strong> — observations, angle diversity, reprojection,
            depth consistency, density, image quality, dynamic probability, visibility. Used as fusion weights
            and measurement warnings.
          </li>
          <li>
            <strong className="text-foreground">Georef</strong> — WGS84 ↔ ECEF ↔ ENU, Umeyama Sim(3). Standalone
            GPS is never advertised as ≤1 m.
          </li>
        </ul>

        <h2 className="mt-10 text-lg font-medium">API (client contract)</h2>
        <pre className="mt-3 overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-[11px] leading-relaxed text-muted">{`POST /projects
POST /projects/{id}/upload
POST /projects/{id}/validate
POST /projects/{id}/process
GET  /projects/{id}/status
GET  /projects/{id}/results
GET  /projects/{id}/metrics
POST /projects/{id}/measure
POST /projects/{id}/resume
POST /projects/{id}/cancel

Implemented locally (IndexedDB + workers). Native engine: POST {base}/sfm and /mvs.`}</pre>

        <h2 className="mt-10 text-lg font-medium">Troubleshooting</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
          <li>Empty model: frames too blurry, or no texture for stereo. Try ACCURACY mode or the sample scene.</li>
          <li>Wrong scale: missing intrinsics or GNSS. Provide SRT/CSV with lat/lon/alt.</li>
          <li>Optimistic RMSE: reprojection px is not metres. Read the accuracy disclaimer.</li>
          <li>Video fails to decode: use MP4 H.264. Sample scene does not need a file.</li>
        </ul>
      </article>
    </AppShell>
  );
}
