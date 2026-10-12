import type { GnssQuality, TelemetrySample } from "./types.ts";

const SRT_BLOCK = /(?:^|\r?\n)(\d+)\r?\n(\d{2}:\d{2}:\d{2}[,.](\d{1,3}))\s*-->\s*(\d{2}:\d{2}:\d{2}[,.](\d{1,3}))\r?\n([\s\S]*?)(?=\r?\n\d+\r?\n\d{2}:|$)/g;

function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return 0;
  const ms = Number((m[4] + "000").slice(0, 3));
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pick(text: string, keys: string[]): number | undefined {
  for (const k of keys) {
    const re = new RegExp(
      `${k}\\s*[:=]\\s*([+-]?\\d+(?:\\.\\d+)?)`,
      "i",
    );
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function gnssFromText(text: string): GnssQuality {
  const t = text.toLowerCase();
  if (/\brtk[_\s-]?fixed\b/.test(t) || /\bfix type\s*[:=]\s*4\b/.test(t)) return "rtk_fixed";
  if (/\brtk[_\s-]?float\b/.test(t) || /\bfix type\s*[:=]\s*5\b/.test(t)) return "rtk_float";
  if (/\bppk\b/.test(t)) return "ppk";
  if (/\bdgps\b|\brtk\b/.test(t)) return "dgps";
  if (/latitude|gps|longitude/.test(t)) return "standalone";
  return "none";
}

/** DJI SRT (classic bracket tags and newer FrameCnt / HTML-ish forms). */
export function parseSrt(text: string): TelemetrySample[] {
  const samples: TelemetrySample[] = [];
  const cleaned = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+>/g, " ");
  const re = new RegExp(SRT_BLOCK.source, "g");
  let m: RegExpExecArray | null;
  let fallbackIndex = 0;
  while ((m = re.exec(cleaned))) {
    const body = m[6];
    const timeS = parseTimestamp(m[2]);
    const lat = pick(body, ["latitude", "lat"]);
    const lon = pick(body, ["longitude", "lon", "long"]);
    const absAlt = pick(body, ["abs_alt", "absalt", "altitude", "alt"]);
    const relAlt = pick(body, ["rel_alt", "relalt", "rel_height"]);
    const yaw = pick(body, ["gb_yaw", "yaw", "heading"]);
    const pitch = pick(body, ["gb_pitch", "pitch"]);
    const roll = pick(body, ["gb_roll", "roll"]);
    const gby = pick(body, ["gb_yaw"]);
    const gbp = pick(body, ["gb_pitch"]);
    const gbr = pick(body, ["gb_roll"]);
    const frame = pick(body, ["framecnt", "frame", "nframe"]);
    const iso = pick(body, ["iso"]);
    const fnum = pick(body, ["fnum", "fnumber", "aperture"]);
    const shutter = pick(body, ["shutter"]);
    const sample: TelemetrySample = {
      timeS,
      frame: frame ?? fallbackIndex,
      lla:
        lat != null && lon != null
          ? { lat, lon, alt: absAlt ?? relAlt ?? 0 }
          : undefined,
      yawDeg: yaw,
      pitchDeg: pitch,
      rollDeg: roll,
      gimbalYawDeg: gby,
      gimbalPitchDeg: gbp,
      gimbalRollDeg: gbr,
      relAltM: relAlt,
      iso,
      shutterS: shutter,
      fnum,
      gnss: gnssFromText(body),
      source: "srt",
      raw: body.trim().slice(0, 400),
    };
    samples.push(sample);
    fallbackIndex++;
  }
  if (samples.length === 0) {
    // Some DJI files are not numbered blocks — split on blank lines.
    const chunks = cleaned.split(/\n\s*\n/);
    let t = 0;
    for (const chunk of chunks) {
      const lat = pick(chunk, ["latitude", "lat"]);
      const lon = pick(chunk, ["longitude", "lon"]);
      if (lat == null || lon == null) continue;
      const absAlt = pick(chunk, ["abs_alt", "altitude", "alt"]);
      samples.push({
        timeS: pick(chunk, ["diffTime"]) ? t : t,
        lla: { lat, lon, alt: absAlt ?? 0 },
        yawDeg: pick(chunk, ["gb_yaw", "yaw"]),
        pitchDeg: pick(chunk, ["gb_pitch", "pitch"]),
        rollDeg: pick(chunk, ["gb_roll", "roll"]),
        relAltM: pick(chunk, ["rel_alt"]),
        gnss: gnssFromText(chunk),
        source: "srt",
      });
      t += 1 / 30;
    }
  }
  return samples;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

const LAT_KEYS = ["lat", "latitude", "y"];
const LON_KEYS = ["lon", "lng", "long", "longitude", "x"];
const ALT_KEYS = ["alt", "altitude", "height", "elev", "z", "abs_alt"];
const TIME_KEYS = ["time", "timestamp", "t", "seconds", "time_s"];
const YAW_KEYS = ["yaw", "heading", "gb_yaw"];
const PITCH_KEYS = ["pitch", "gb_pitch"];
const ROLL_KEYS = ["roll", "gb_roll"];

function col(map: Map<string, number>, keys: string[]): number | undefined {
  for (const k of keys) {
    if (map.has(k)) return map.get(k);
  }
  return undefined;
}

export function parseCsvTelemetry(text: string): TelemetrySample[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(headerKey);
  const idx = new Map(headers.map((h, i) => [h, i]));
  const iLat = col(idx, LAT_KEYS);
  const iLon = col(idx, LON_KEYS);
  const iAlt = col(idx, ALT_KEYS);
  const iTime = col(idx, TIME_KEYS);
  const iYaw = col(idx, YAW_KEYS);
  const iPitch = col(idx, PITCH_KEYS);
  const iRoll = col(idx, ROLL_KEYS);
  const iFix = col(idx, ["fix", "gnss", "quality", "rtk"]);
  if (iLat == null || iLon == null) {
    throw new Error("CSV telemetry needs latitude and longitude columns");
  }
  const samples: TelemetrySample[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    const lat = num(cells[iLat]);
    const lon = num(cells[iLon]);
    if (lat == null || lon == null) continue;
    const tRaw = iTime != null ? cells[iTime] : undefined;
    let timeS: number;
    if (tRaw && /^\d{2}:/.test(tRaw)) timeS = parseTimestamp(tRaw + (tRaw.includes(",") || tRaw.includes(".") ? "" : ".000"));
    else timeS = num(tRaw) ?? (r - 1) / 10;
    const fix = (iFix != null ? cells[iFix] : "")?.toLowerCase() ?? "";
    let gnss: GnssQuality = "standalone";
    if (fix.includes("rtk_fixed") || fix === "4") gnss = "rtk_fixed";
    else if (fix.includes("float") || fix === "5") gnss = "rtk_float";
    else if (fix.includes("ppk")) gnss = "ppk";
    else if (fix.includes("dgps")) gnss = "dgps";
    samples.push({
      timeS,
      lla: { lat, lon, alt: iAlt != null ? (num(cells[iAlt]) ?? 0) : 0 },
      yawDeg: iYaw != null ? num(cells[iYaw]) : undefined,
      pitchDeg: iPitch != null ? num(cells[iPitch]) : undefined,
      rollDeg: iRoll != null ? num(cells[iRoll]) : undefined,
      gnss,
      source: "csv",
    });
  }
  return samples;
}

export function parseGpx(text: string): TelemetrySample[] {
  const samples: TelemetrySample[] = [];
  const trkpt = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = trkpt.exec(text))) {
    const attrs = m[1];
    const body = m[2];
    const lat = num(attrs.match(/lat=["']([^"']+)["']/i)?.[1]);
    const lon = num(attrs.match(/lon=["']([^"']+)["']/i)?.[1]);
    if (lat == null || lon == null) continue;
    const ele = num(body.match(/<ele>\s*([^<]+)/i)?.[1]);
    const timeIso = body.match(/<time>\s*([^<]+)/i)?.[1];
    let timeS = i;
    if (timeIso) {
      const ms = Date.parse(timeIso.trim());
      if (Number.isFinite(ms)) timeS = ms / 1000;
    }
    const course = num(body.match(/<course>\s*([^<]+)/i)?.[1]);
    samples.push({
      timeS,
      lla: { lat, lon, alt: ele ?? 0 },
      yawDeg: course,
      gnss: "standalone",
      source: "gpx",
    });
    i++;
  }
  if (samples.length && samples[0].timeS > 1e8) {
    const t0 = samples[0].timeS;
    for (const s of samples) s.timeS -= t0;
  }
  return samples;
}

export function parseJsonTelemetry(text: string): TelemetrySample[] {
  const data = JSON.parse(text) as unknown;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { samples?: unknown }).samples)
      ? (data as { samples: unknown[] }).samples
      : Array.isArray((data as { telemetry?: unknown }).telemetry)
        ? (data as { telemetry: unknown[] }).telemetry
        : null;
  if (!arr) throw new Error("JSON telemetry must be an array or { samples | telemetry }");
  return arr.map((row, i) => {
    const r = row as Record<string, unknown>;
    const lat = Number(r.lat ?? r.latitude);
    const lon = Number(r.lon ?? r.lng ?? r.longitude);
    const alt = Number(r.alt ?? r.altitude ?? r.height ?? 0);
    const timeS = Number(r.timeS ?? r.t ?? r.time ?? i / 10);
    const gnssRaw = String(r.gnss ?? r.fix ?? "standalone") as GnssQuality;
    return {
      timeS: Number.isFinite(timeS) ? timeS : i / 10,
      lla: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, alt: Number.isFinite(alt) ? alt : 0 } : undefined,
      yawDeg: num(String(r.yaw ?? r.heading ?? "")),
      pitchDeg: num(String(r.pitch ?? "")),
      rollDeg: num(String(r.roll ?? "")),
      gimbalYawDeg: num(String(r.gb_yaw ?? "")),
      gimbalPitchDeg: num(String(r.gb_pitch ?? "")),
      gimbalRollDeg: num(String(r.gb_roll ?? "")),
      relAltM: num(String(r.rel_alt ?? "")),
      gnss: ["none", "standalone", "dgps", "rtk_float", "rtk_fixed", "ppk"].includes(gnssRaw)
        ? gnssRaw
        : "standalone",
      source: "json",
    } satisfies TelemetrySample;
  });
}

export function parseTelemetry(filename: string, text: string): TelemetrySample[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".srt")) return parseSrt(text);
  if (lower.endsWith(".gpx")) return parseGpx(text);
  if (lower.endsWith(".json")) return parseJsonTelemetry(text);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsvTelemetry(text);
  // sniff
  if (text.includes("-->") && /\d{2}:\d{2}:\d{2}/.test(text)) return parseSrt(text);
  if (text.includes("<gpx") || text.includes("<trkpt")) return parseGpx(text);
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) return parseJsonTelemetry(text);
  return parseCsvTelemetry(text);
}

export interface SyncReport {
  samples: TelemetrySample[];
  durationS: number;
  hz: number;
  gpsCount: number;
  imuCount: number;
  gnss: GnssQuality;
  gaps: { start: number; end: number }[];
  coverage: number;
  timeOffsetS: number;
}

export function analyzeTelemetry(samples: TelemetrySample[], videoDurationS?: number): SyncReport {
  if (!samples.length) {
    return {
      samples,
      durationS: 0,
      hz: 0,
      gpsCount: 0,
      imuCount: 0,
      gnss: "none",
      gaps: [],
      coverage: 0,
      timeOffsetS: 0,
    };
  }
  const sorted = samples.slice().sort((a, b) => a.timeS - b.timeS);
  const durationS = sorted[sorted.length - 1].timeS - sorted[0].timeS;
  const dts: number[] = [];
  const gaps: { start: number; end: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].timeS - sorted[i - 1].timeS;
    dts.push(dt);
    if (dt > 1.5) gaps.push({ start: sorted[i - 1].timeS, end: sorted[i].timeS });
  }
  const med = median(dts.filter((d) => d > 0)) || 0.1;
  const gpsCount = sorted.filter((s) => s.lla).length;
  const imuCount = sorted.filter((s) => s.yawDeg != null || s.pitchDeg != null).length;
  const rank: GnssQuality[] = ["none", "standalone", "dgps", "rtk_float", "ppk", "rtk_fixed"];
  let best: GnssQuality = "none";
  for (const s of sorted) {
    if (rank.indexOf(s.gnss) > rank.indexOf(best)) best = s.gnss;
  }
  const span = videoDurationS ?? durationS;
  const coverage = span > 0 ? Math.min(1, durationS / span) : 1;
  return {
    samples: sorted,
    durationS,
    hz: med > 0 ? 1 / med : 0,
    gpsCount,
    imuCount,
    gnss: best,
    gaps,
    coverage,
    timeOffsetS: sorted[0].timeS,
  };
}

export function sampleAt(samples: TelemetrySample[], timeS: number): TelemetrySample | null {
  if (!samples.length) return null;
  let lo = 0,
    hi = samples.length - 1;
  if (timeS <= samples[0].timeS) return samples[0];
  if (timeS >= samples[hi].timeS) return samples[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeS < timeS) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const u = (timeS - a.timeS) / Math.max(1e-9, b.timeS - a.timeS);
  const lerp = (x?: number, y?: number) =>
    x == null && y == null ? undefined : x == null ? y : y == null ? x : x + (y - x) * u;
  const lla =
    a.lla && b.lla
      ? {
          lat: a.lla.lat + (b.lla.lat - a.lla.lat) * u,
          lon: a.lla.lon + (b.lla.lon - a.lla.lon) * u,
          alt: a.lla.alt + (b.lla.alt - a.lla.alt) * u,
        }
      : (a.lla ?? b.lla);
  return {
    timeS,
    lla,
    yawDeg: lerp(a.yawDeg, b.yawDeg),
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg),
    rollDeg: lerp(a.rollDeg, b.rollDeg),
    gimbalYawDeg: lerp(a.gimbalYawDeg, b.gimbalYawDeg),
    gimbalPitchDeg: lerp(a.gimbalPitchDeg, b.gimbalPitchDeg),
    gimbalRollDeg: lerp(a.gimbalRollDeg, b.gimbalRollDeg),
    relAltM: lerp(a.relAltM, b.relAltM),
    gnss: a.gnss,
    source: a.source,
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}
