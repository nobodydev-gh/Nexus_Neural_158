# Benchmarking

Target (not a claim): 10-minute video → <15 minutes on a 6 GB GPU with native COLMAP. The in-browser CPU engine is for interactive jobs and the sample site.

Record per job (processing log + `metadata.json`):

- total and per-stage runtime
- JS heap (browser); VRAM only when a native worker reports it
- selected vs registered frames
- point count, triangle count
- confidence coverage
- RMSE / completeness when GT exists

FAST uses fewer frames and skips selective fill. ACCURACY densifies MVS.
