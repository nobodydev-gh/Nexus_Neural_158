import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject, loadResult } from "@/lib/projects";
import type { ReconstructResult } from "@/pipeline/types";
import {
  accuracyReportHtml,
  camerasJson,
  metadataJson,
  processingReportHtml,
  toConfidencePly,
  toLas,
  toObj,
  toPly,
  validationJson,
} from "@/pipeline/export";

export const Route = createFileRoute("/projects/$id/export")({ component: ExportPage });

function ExportPage() {
  const { id } = Route.useParams();
  const [result, setResult] = useState<ReconstructResult | undefined>();
  const project = getProject(id);
  useEffect(() => {
    void loadResult(id).then(setResult);
  }, [id]);

  const download = (name: string, data: BlobPart, mime = "text/plain") => {
    const blob = new Blob([data], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportGlb = async () => {
    if (!result || !result.mesh.vertexCount) return;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(result.mesh.vertexCount * 3);
    for (let i = 0; i < result.mesh.vertexCount; i++) {
      pos[i * 3] = result.mesh.positions[i * 3];
      pos[i * 3 + 1] = result.mesh.positions[i * 3 + 2];
      pos[i * 3 + 2] = -result.mesh.positions[i * 3 + 1];
    }
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(result.mesh.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(result.mesh.indices, 1));
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true }));
    const scene = new THREE.Scene();
    scene.add(mesh);
    const exporter = new GLTFExporter();
    const buf = await exporter.parseAsync(scene, { binary: true });
    const data = buf instanceof ArrayBuffer ? buf : new TextEncoder().encode(JSON.stringify(buf));
    download("mesh.glb", data, "model/gltf-binary");
    geom.dispose();
  };

  if (!result) {
    return (
      <AppShell projectId={id}>
        <div className="p-8 text-sm text-muted">Nothing to export yet.</div>
      </AppShell>
    );
  }

  return (
    <AppShell projectId={id}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">EXPORT</p>
        <h1 className="mt-2 text-2xl font-medium">{project?.name}</h1>
        <p className="mt-2 text-sm text-muted">
          Files match the TERRASPLAT output contract. Geometry is ENU metres relative to the GNSS origin.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Geometry</CardTitle>
            <CardDescription>
              {result.stats.pointCount.toLocaleString()} points · {result.stats.triangleCount.toLocaleString()} triangles
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => download("pointcloud.ply", toPly(result.points))}>
              pointcloud.ply
            </Button>
            <Button size="sm" variant="secondary" onClick={() => download("confidence.ply", toConfidencePly(result.points))}>
              confidence.ply
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const { obj, mtl } = toObj(result.mesh);
                download("mesh.obj", obj);
                download("mesh.mtl", mtl);
              }}
            >
              mesh.obj
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void exportGlb()}>
              mesh.glb
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => download("pointcloud.las", toLas(result.points), "application/octet-stream")}
            >
              pointcloud.las
            </Button>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Metadata & reports</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => download("cameras.json", JSON.stringify(camerasJson(result.cameras, result.origin), null, 2), "application/json")}
            >
              cameras.json
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  "trajectory.json",
                  JSON.stringify({ camera: result.cameraTrajectory, gps: result.gpsTrajectory }, null, 2),
                  "application/json",
                )
              }
            >
              trajectory.json
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download("metadata.json", JSON.stringify(metadataJson(result), null, 2), "application/json")}
            >
              metadata.json
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download("validation.json", JSON.stringify(validationJson(result), null, 2), "application/json")}
            >
              validation.json
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download("accuracy_report.html", accuracyReportHtml(result), "text/html")}
            >
              accuracy_report.html
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download("processing_report.html", processingReportHtml(result), "text/html")}
            >
              processing_report.html
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
