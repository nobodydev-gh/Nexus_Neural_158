# Troubleshooting

- **Blank model** — frames too blurry or textureless. Run the sample site to verify the engine; then use ACCURACY on real video.
- **No georeference** — SRT/CSV missing lat/lon. Model stays in ENU with origin (0,0,0) if GNSS is absent (reported as a limitation).
- **Optimistic numbers** — do not quote mean reprojection px as metres.
- **Video decode** — prefer H.264 MP4. Sample reconstruction does not need a file.
- **Worker failed** — the app falls back to the main thread. Close other tabs if the tab is OOM.
- **Native GLOMAP not used** — expected unless a local worker is attached. The accuracy report says so.
