# Accuracy

Reprojection error (pixels) is **not** real-world accuracy.

| GNSS | What TERRASPLAT will say |
| --- | --- |
| none | Local frame only |
| standalone | Typically 2–5 m. Not ≤1 m |
| DGPS | Metre-class |
| RTK float | Decimetre-class until fixed |
| RTK fixed / PPK | High-accuracy mode. Still needs a documented datum |

Independent RMSE (X/Y/Z, 3D, median, P95, completeness, trajectory) is computed only when ground-truth checkpoints or the synthetic scene exist. Otherwise the report states that absolute accuracy has not been independently established.
