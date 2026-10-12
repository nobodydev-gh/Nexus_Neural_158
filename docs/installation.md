# Installation

TERRASPLAT's interactive app is the in-browser engine. No COLMAP install is required to reconstruct the sample site or a short UAV clip.

## App

Dependencies are already in `package.json` (`three`, React Three Fiber, TanStack Start). After models/deps are present the pipeline is **offline-first** — it does not call a cloud AI API.

## Optional native worker (GLOMAP / COLMAP / OpenMVS)

On a machine with a GPU, run a local worker that implements `src/pipeline/hooks.ts`:

```
POST {base}/sfm   → cameras, sparse points, reprojection, tracks
POST {base}/mvs   → dense points
```

Suggested binaries (not bundled):

- GLOMAP (primary SfM)
- COLMAP mapper + PatchMatch stereo
- OpenMVS densify + mesh
- MASt3R-SfM only if `registered_ratio < 0.6`
- YOLO11-seg + ByteTrack for people / vehicles / animals
- Depth Anything V2 ONNX, scale-aligned to MVS, weak cells only

The in-browser engine stays the fallback so a demo never depends on those binaries being present.
