# Pipeline

1. **Ingestion** — video frames (canvas) + DJI SRT / CSV / GPX / JSON. Sync by timestamp.
2. **Keyframes** — adaptive (not every 3 m).
3. **Masks** — ego-motion residual; YOLO hook optional.
4. **SfM** — GNSS/IMU pose prior + FAST/BRIEF + triangulation. GLOMAP native if attached.
5. **Dense MVS** — PatchMatch photoconsistency. Metric backbone.
6. **AI depth** — skipped in FAST; otherwise selective fill of weak cells only.
7. **Fusion** — voxel merge, confidence-weighted, AI-depth down-weighted.
8. **Mesh** — visibility grid; holes where unobserved.
9. **Texture** — colour from the sharp contributing view.
10. **Georef** — WGS84 ENU, Umeyama Sim(3).
11. **Validation** — RMSE only with independent GT; always emit limitations.
