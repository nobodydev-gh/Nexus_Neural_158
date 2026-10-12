# Architecture

```
UI (TanStack Start + React)
  └─ jobs in localStorage / reconstruction blobs in IndexedDB
       └─ Web Worker  src/pipeline/worker.ts
            ├─ ingestion → keyframes → masks
            ├─ SfM (GLOMAP-lite or external /sfm)
            ├─ MVS PatchMatch (or external /mvs)
            ├─ selective fill, fusion, mesh, texture
            └─ georef + validation
```

Pages: Dashboard, New, Input validation, Processing, 3D viewer, Accuracy, Export, Docs.

Processing modes: FAST, BALANCED (default), ACCURACY.

Checkpoint stages `01_ingestion` … `11_validation` are recorded on every job. Resume re-runs from the current inputs (frames already extracted stay in memory for the session).
