# TERRASPLAT (Nexus_Neural_158)

> **Observability-Aware Single-Pass Drone Video → Georeferenced 3D Models**  
> *Target: Smart India Hackathon 2026 · Problem Statement 26158 (NTRO)*

[![Live Demo](https://img.shields.io/badge/Demo-terrasplat.cappace.me-2ea44f.svg?logo=vercel&logoColor=white)](https://terrasplat.cappace.me)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-black.svg)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS%20v4-38bdf8.svg)](https://tailwindcss.com/)

🌐 **Live Demo:** [https://terrasplat.cappace.me](https://terrasplat.cappace.me)

---

## 📌 Problem Statement (SIH PS 26158)

Traditional aerial photogrammetry requires extensive multi-pass cross-grid flights, high visual overlap (>75%), and heavy offline server processing. In tactical, emergency, or reconnaissance operations conducted by UAVs, only **a single flight pass** is feasible.

Standard photogrammetric pipelines fail or yield distorted geometry on single-pass data due to limited parallax, baseline ambiguities, and occlusions. Furthermore, conventional tools report reprojection errors rather than true ground-truth observability.

**TERRASPLAT** delivers a complete, end-to-end photogrammetry and observability engine that takes **one single drone video pass** plus flight telemetry (DJI SRT, CSV, GPX, JSON) and reconstructs **dense, georeferenced 3D models with per-point observability maps**.

---

## 🚀 Key Features

- **Single-Pass Reconstruction**: Metric 3D reconstruction from single-direction UAV flight videos without requiring cross-grid flight paths.
- **Observability & Confidence Maps**: Every reconstructed 3D point is categorized into **`HIGH`**, **`MEDIUM`**, **`LOW`**, or **`UNOBSERVED`** based on ray-intersection geometry, photoconsistency, and visual coverage.
- **Sim(3) Georeferencing**: Aligns models into standard **WGS84**, **ECEF**, and local **ENU** frames with honest GNSS/RTK uncertainty propagation.
- **Client-Side / Offline-First**: Entire pipeline runs locally in the browser utilizing WebGL and Web Workers, persisting jobs in IndexedDB with zero mandatory cloud AI APIs.
- **Interactive 3D Viewer**: Built on Three.js / React Three Fiber with confidence toggles, metric measurement tools, and cross-section analysis.
- **Multi-Format Export**: Export results to industry-standard 3D formats: **PLY**, **OBJ**, **GLB**, **LAS**, JSON telemetry, and audit-ready HTML reports.
- **Native Extensibility**: Optional native bridge in `src/pipeline/hooks.ts` for integrating GLOMAP, COLMAP, OpenMVS, YOLO, and Depth Anything V2.

---

## 🏗️ Architecture & Pipeline Flow

```text
┌────────────────────────────────────────────────────────┐
│  Drone Video (MP4/MOV) + Telemetry (DJI SRT/CSV/GPX)   │
└───────────────────────────┬────────────────────────────┘
                            │
              [1. Adaptive Keyframe Extraction]
  (Laplacian blur filter, FAST quality, GNSS displacement, FOV parallax)
                            │
              [2. GLOMAP-Lite Pose Initialization]
       (GNSS/IMU integration + FAST/BRIEF multi-frame tracks)
                            │
              [3. PatchMatch MVS Metric Backbone]
   (Multi-view photometric consistency along estimated visual rays)
                            │
              [4. Observability & Confidence Fusion]
(Confidence-weighted voxel fusion: HIGH / MEDIUM / LOW / UNOBSERVED)
                            │
              [5. Sim(3) Georeferencing & Meshing]
       (WGS84 / ECEF / ENU transformation + visibility-aware mesh)
                            │
              [6. 3D Inspection & Multi-Format Export]
        (Interactive Three.js viewer, measurement warnings,
         PLY / OBJ / GLB / LAS / HTML Accuracy Audit)
```

---

## 🛠️ Supported Inputs & Outputs

### Inputs
- **Video**: MP4, MOV, AVI, MKV drone footage.
- **Telemetry**: DJI SRT embedded subtitle files, CSV logs, GPX traces, JSON flight logs.
- **Sensors**: GNSS/GPS coordinates, IMU (pitch/roll/yaw), barometric altitude, and optional RTK/PPK corrections.

### Exports
| Format | Description |
| :--- | :--- |
| **PLY** | Dense point cloud with RGB and per-point confidence scalar |
| **OBJ** | 3D mesh geometry with material attributes |
| **GLB** | Optimized binary 3D model for web and AR viewers |
| **LAS** | ASPRS LiDAR/geospatial point format with georeference headers |
| **HTML / JSON** | Full survey accuracy audit and observability metrics report |

---

## ⚡ Quickstart

> 💡 **Try it Live Without Setup:** A live version of the platform is hosted at **[https://terrasplat.cappace.me](https://terrasplat.cappace.me)**.

### Prerequisites
- [Node.js](https://nodejs.org/) v20 or higher
- npm or pnpm

### Installation

```bash
# 1. Clone repository
git clone git@github.com:JoyCodz/Nexus_Neural_158.git
cd Nexus_Neural_158

# 2. Install dependencies
npm install

# 3. Start local development server
npm run dev
```

Open your browser and navigate to `http://localhost:8080`.

---

## 📖 How to Use

1. **Test with Synthetic Ground Truth**:
   Click **"Reconstruct sample site"** on the home dashboard. This runs the full pipeline against an independent ground-truth synthetic site (16×10×7 m structure) to evaluate accuracy without uploading files.
2. **Upload Custom Flight Data**:
   Navigate to **"New reconstruction"**, select your UAV video and telemetry log, choose your reconstruction preset (**Fast**, **Balanced**, or **Accuracy**), and launch the pipeline.
3. **Analyze Observability**:
   In the 3D Viewer, inspect the model, toggle between RGB and Confidence color modes, measure distances (with warnings on low-confidence vertices), and review the audit report.
4. **Export Artifacts**:
   Navigate to the Export tab to download PLY, OBJ, GLB, LAS, or audit reports.

---

## 📚 Technical Documentation

Detailed technical references are located in the [`docs/`](docs/) directory:
- [System Architecture](docs/architecture.md)
- [Pipeline Deep-Dive](docs/pipeline.md)
- [Algorithms & Mathematics](docs/algorithms.md)
- [Survey Accuracy vs Reprojection Error](docs/accuracy.md)
- [Benchmarking & Evaluation](docs/benchmarking.md)
- [Native Worker API Contract](docs/API.md)
- [Installation Guide](docs/installation.md)
- [Troubleshooting](docs/troubleshooting.md)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
