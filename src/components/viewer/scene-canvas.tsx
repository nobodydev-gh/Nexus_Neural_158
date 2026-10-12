import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import type { CameraPose, ConfidenceClass, ReconstructResult, Vec3 } from "@/pipeline/types";
import { measure, type MeasureKind, type MeasureResult } from "@/pipeline/measure";
import { formatMeters } from "@/lib/utils";

export type LayerId = "points" | "mesh" | "confidence" | "cameras" | "gps" | "grid";

export interface ViewerLayers {
  points: boolean;
  mesh: boolean;
  confidence: boolean;
  cameras: boolean;
  gps: boolean;
  grid: boolean;
}

function enuToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

function klassColor(k: ConfidenceClass): [number, number, number] {
  if (k === "high") return [0.36, 0.6, 0.48];
  if (k === "medium") return [0.77, 0.63, 0.35];
  if (k === "low") return [0.77, 0.48, 0.35];
  return [0.36, 0.4, 0.38];
}

function Cloud({
  result,
  confidence,
  visible,
}: {
  result: ReconstructResult;
  confidence: boolean;
  visible: boolean;
}) {
  const geom = useMemo(() => {
    const n = result.points.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = result.points[i];
      const [x, y, z] = enuToThree(p.x, p.y, p.z);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const c = confidence ? klassColor(p.klass) : [p.r, p.g, p.b];
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }, [result, confidence]);
  useEffect(() => () => geom.dispose(), [geom]);
  if (!visible) return null;
  return (
    <points geometry={geom} frustumCulled={false}>
      <pointsMaterial size={0.45} vertexColors sizeAttenuation depthWrite={false} />
    </points>
  );
}

function SiteMesh({ result, visible, confidence }: { result: ReconstructResult; visible: boolean; confidence: boolean }) {
  const geom = useMemo(() => {
    const m = result.mesh;
    if (!m.vertexCount) return null;
    const pos = new Float32Array(m.vertexCount * 3);
    const col = new Float32Array(m.vertexCount * 3);
    for (let i = 0; i < m.vertexCount; i++) {
      const [x, y, z] = enuToThree(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      if (confidence) {
        const c = m.confidence[i] ?? 0;
        const k: ConfidenceClass = c >= 0.72 ? "high" : c >= 0.42 ? "medium" : c > 0.12 ? "low" : "unobserved";
        const rgb = klassColor(k);
        col[i * 3] = rgb[0];
        col[i * 3 + 1] = rgb[1];
        col[i * 3 + 2] = rgb[2];
      } else {
        col[i * 3] = m.colors[i * 3] ?? 0.7;
        col[i * 3 + 1] = m.colors[i * 3 + 1] ?? 0.7;
        col[i * 3 + 2] = m.colors[i * 3 + 2] ?? 0.7;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [result, confidence]);
  useEffect(() => () => geom?.dispose(), [geom]);
  if (!visible || !geom) return null;
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial vertexColors roughness={0.85} metalness={0.02} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Trajectory({
  points,
  color,
  visible,
}: {
  points: Vec3[];
  color: string;
  visible: boolean;
}) {
  const obj = useMemo(() => {
    const arr = points.map((p) => new THREE.Vector3(...enuToThree(p.x, p.y, p.z)));
    const g = new THREE.BufferGeometry().setFromPoints(arr);
    const m = new THREE.LineBasicMaterial({ color, linewidth: 1 });
    return new THREE.Line(g, m);
  }, [points, color]);
  useEffect(
    () => () => {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    },
    [obj],
  );
  if (!visible || points.length < 2) return null;
  return <primitive object={obj} />;
}

function CameraRigs({ poses, visible }: { poses: CameraPose[]; visible: boolean }) {
  const lines = useMemo(() => {
    const positions: number[] = [];
    for (const p of poses) {
      const [x, y, z] = enuToThree(p.C.x, p.C.y, p.C.z);
      const fx = p.R[2],
        fy = p.R[5],
        fz = p.R[8];
      const [tx, ty, tz] = enuToThree(p.C.x + fx * 2.4, p.C.y + fy * 2.4, p.C.z + fz * 2.4);
      positions.push(x, y, z, tx, ty, tz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({ color: "#9db8a8" });
    return new THREE.LineSegments(g, m);
  }, [poses]);
  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
    [lines],
  );
  if (!visible) return null;
  return (
    <group>
      <primitive object={lines} />
      {poses.map((p) => {
        const [x, y, z] = enuToThree(p.C.x, p.C.y, p.C.z);
        return (
          <mesh key={p.frameIndex} position={[x, y, z]}>
            <sphereGeometry args={[0.32, 10, 10]} />
            <meshBasicMaterial color={p.registered ? "#9db8a8" : "#c47a5a"} />
          </mesh>
        );
      })}
    </group>
  );
}

function MeasureOverlay({
  picks,
  last,
}: {
  picks: Vec3[];
  last: MeasureResult | null;
}) {
  const obj = useMemo(() => {
    if (picks.length < 2) return null;
    const arr = picks.map((p) => new THREE.Vector3(...enuToThree(p.x, p.y, p.z)));
    if (picks.length > 2) arr.push(arr[0].clone());
    const g = new THREE.BufferGeometry().setFromPoints(arr);
    const m = new THREE.LineBasicMaterial({ color: "#d5e0d8" });
    return new THREE.Line(g, m);
  }, [picks]);
  useEffect(
    () => () => {
      if (!obj) return;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    },
    [obj],
  );
  return (
    <group>
      {picks.map((p, i) => {
        const [x, y, z] = enuToThree(p.x, p.y, p.z);
        return (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[0.28, 12, 12]} />
            <meshBasicMaterial color="#d5e0d8" />
          </mesh>
        );
      })}
      {obj ? <primitive object={obj} /> : null}
      {last && picks.length >= 2 ? (
        <Html position={enuToThree(picks[picks.length - 1].x, picks[picks.length - 1].y, picks[picks.length - 1].z)}>
          <div className="rounded-md border border-border bg-card/95 px-2 py-1 font-mono text-[11px] text-foreground shadow-sm">
            {formatMeters(last.valueM)} {last.unit === "m" ? "" : last.unit}
            {last.warning ? <div className="max-w-48 text-[10px] text-conf-low">{last.warning}</div> : null}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function Picker({
  enabled,
  result,
  kind,
  onMeasure,
}: {
  enabled: boolean;
  result: ReconstructResult;
  kind: MeasureKind;
  onMeasure: (r: MeasureResult, picks: Vec3[]) => void;
}) {
  const { camera, gl, scene } = useThree();
  const picks = useRef<Vec3[]>([]);
  useEffect(() => {
    if (!enabled) {
      picks.current = [];
      return;
    }
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.8 };
    const ndc = new THREE.Vector2();
    const onClick = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(scene.children, true);
      const hit = hits.find((h) => h.point);
      if (!hit) return;
      const enu: Vec3 = { x: hit.point.x, y: -hit.point.z, z: hit.point.y };
      const need = kind === "area" || kind === "volume" ? 3 : 2;
      picks.current = [...picks.current, enu].slice(-(kind === "area" || kind === "volume" ? 8 : 2));
      if (picks.current.length >= need) {
        const r = measure({ kind, points: picks.current }, result.points, result.mesh);
        onMeasure(r, picks.current);
      } else {
        onMeasure({ kind, valueM: 0, unit: "m", confidence: "high" }, picks.current);
      }
    };
    gl.domElement.addEventListener("pointerdown", onClick);
    return () => gl.domElement.removeEventListener("pointerdown", onClick);
  }, [enabled, camera, gl, scene, kind, result, onMeasure]);
  return null;
}

function HoverCoord({ onCoord }: { onCoord: (s: string) => void }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.6 };
    const ndc = new THREE.Vector2();
    const move = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(scene.children, true);
      const hit = hits.find((h) => h.point);
      if (!hit) {
        onCoord("—");
        return;
      }
      const e = hit.point.x;
      const n = -hit.point.z;
      const u = hit.point.y;
      onCoord(`E ${e.toFixed(2)}  N ${n.toFixed(2)}  U ${u.toFixed(2)} m`);
    };
    gl.domElement.addEventListener("pointermove", move);
    return () => gl.domElement.removeEventListener("pointermove", move);
  }, [camera, gl, scene, onCoord]);
  return null;
}

export function SceneCanvas({
  result,
  layers,
  measureKind,
  measuring,
  onMeasure,
  onCoord,
}: {
  result: ReconstructResult;
  layers: ViewerLayers;
  measureKind: MeasureKind;
  measuring: boolean;
  onMeasure: (r: MeasureResult, picks: Vec3[]) => void;
  onCoord: (s: string) => void;
}) {
  const [picks, setPicks] = useState<Vec3[]>([]);
  const [last, setLast] = useState<MeasureResult | null>(null);
  const handle = (r: MeasureResult, p: Vec3[]) => {
    setPicks(p);
    setLast(r);
    onMeasure(r, p);
  };
  return (
    <Canvas
      camera={{ position: [28, 22, 28], fov: 45, near: 0.1, far: 2000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => {
        gl.setClearColor("#090b0a");
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 80, 20]} intensity={1.1} />
      <directionalLight position={[-20, 30, -40]} intensity={0.25} />
      {layers.grid ? (
        <Grid
          args={[80, 80]}
          cellSize={2}
          cellColor="#232a26"
          sectionSize={10}
          sectionColor="#3a4540"
          fadeDistance={120}
          fadeStrength={1.2}
          position={[0, 0, 0]}
        />
      ) : null}
      <Cloud result={result} confidence={layers.confidence} visible={layers.points} />
      <SiteMesh result={result} visible={layers.mesh} confidence={layers.confidence} />
      <Trajectory points={result.cameraTrajectory.points} color="#9db8a8" visible={layers.cameras} />
      <CameraRigs poses={result.cameras} visible={layers.cameras} />
      <Trajectory points={result.gpsTrajectory.points} color="#6b7c74" visible={layers.gps} />
      <MeasureOverlay picks={picks} last={last} />
      <Picker enabled={measuring} result={result} kind={measureKind} onMeasure={handle} />
      <HoverCoord onCoord={onCoord} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.49} />
      <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
        <GizmoViewport axisColors={["#c47a5a", "#5d9a7a", "#9db8a8"]} labelColor="#e6ebe7" />
      </GizmoHelper>
    </Canvas>
  );
}
