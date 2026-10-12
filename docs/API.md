# API

Client-side job API (IndexedDB), matching the product contract:

```
POST /projects
POST /projects/{id}/upload
POST /projects/{id}/validate
POST /projects/{id}/process
GET  /projects/{id}/status
GET  /projects/{id}/results
GET  /projects/{id}/metrics
POST /projects/{id}/measure
POST /projects/{id}/resume
POST /projects/{id}/cancel
```

Native engine:

```
POST {base}/sfm
POST {base}/mvs
```

See `src/pipeline/hooks.ts` for the JSON schema. Measurement lives in `src/pipeline/measure.ts` and is also invoked from the Three.js viewer.
