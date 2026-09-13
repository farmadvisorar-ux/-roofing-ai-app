// Ingesting NOAA Storm Prediction Center severe-weather reports.
//
// SPC publishes the same events through three feeds, in decreasing order of
// quality and increasing order of freshness:
//
//   archive  1955-YYYY_hail.csv.zip   quality-controlled, a year or two behind
//   annual   YYYY_hail.csv            this year so far, preliminary
//   daily    YYMMDD_rpts_hail.csv     the last few days, preliminary
//
// Selling on fresh storms needs the daily feed; trusting the numbers needs the
// archive. So all three are ingested, preliminary rows are flagged, and the
// confirmed archive supersedes preliminary rows for any year it covers.
//
// Two format traps, both verified against the real files:
//
//   1. Archive and annual timestamps are in CST (the `tz` column is 3), not UTC.
//      Ignoring that dates 33% of reports a day early and makes the archive
//      disagree with the daily feed about the same physical event.
//   2. A daily file covers a *convective* day, 12Z to 12Z. A report timed before
//      1200 belongs to the following calendar day.
import { StormKind } from "@/generated/prisma/enums";

export type StormSource = "archive" | "annual" | "daily";
export type SourceKind = "hail" | "wind";

export interface StormRecord {
  kind: StormKind;
  occurredAt: Date;
  lat: number;
  lng: number;
  /** Hail diameter in inches, or gust speed in knots. */
  magnitude: number | null;
  state: string | null;
  sourceKey: string;
  source: StormSource;
  preliminary: boolean;
}

const SPC_BASE = process.env.SPC_BASE_URL ?? "https://www.spc.noaa.gov";

/** SPC records archive times in CST year-round; tz=3 is their code for it. */
const CST_OFFSET_HOURS = 6;
/** A convective day runs 12Z to 12Z. */
const CONVECTIVE_DAY_START_HHMM = 1200;
/** SPC's placeholder for an unknown location. */
const NULL_ISLAND = 0;

export function archiveUrl(year: number, kind: SourceKind): string {
  return `${SPC_BASE}/wcm/data/1955-${year}_${kind}.csv.zip`;
}

export function annualUrl(year: number, kind: SourceKind): string {
  return `${SPC_BASE}/wcm/data/${year}_${kind}.csv`;
}

/** Daily files are named by the convective day in YYMMDD. */
export function dailyUrl(day: Date, kind: SourceKind): string {
  const yy = String(day.getUTCFullYear()).slice(2);
  const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(day.getUTCDate()).padStart(2, "0");
  return `${SPC_BASE}/climo/reports/${yy}${mm}${dd}_rpts_${kind}.csv`;
}

// --- Parsing --------------------------------------------------------------

/**
 * Archive and annual files share a column layout. `preliminary` differs: the
 * annual file is this year's unverified reports, the archive is quality
 * controlled.
 */
export function parseArchiveRow(
  row: Record<string, string>,
  kind: SourceKind,
  source: "archive" | "annual",
): StormRecord | null {
  const lat = Number(row.slat);
  const lng = Number(row.slon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === NULL_ISLAND && lng === NULL_ISLAND) return null;

  const occurredAt = parseCstTimestamp(row.date, row.time);
  if (!occurredAt) return null;

  const magnitude = Number(row.mag);
  const year = row.date.slice(0, 4);

  return {
    kind: kind === "hail" ? StormKind.HAIL : StormKind.WIND,
    occurredAt,
    lat,
    lng,
    magnitude: Number.isFinite(magnitude) && magnitude > 0 ? magnitude : null,
    state: row.st?.toUpperCase() || null,
    // `om` is unique within a year in the archive and a timestamped string in the
    // annual file; pairing it with the date and position is stable in both.
    sourceKey: `${kind}:${year}:${row.om}:${row.date}:${lat},${lng}`,
    source,
    preliminary: source === "annual",
  };
}

/**
 * Daily report files have their own layout entirely:
 *   hail  Time,Size,Location,County,State,Lat,Lon,Comments   (Size in 1/100 inch)
 *   wind  Time,Speed,Location,County,State,Lat,Lon,Comments  (Speed in knots)
 * with no date column — the date is the filename, adjusted for the 12Z boundary.
 */
export function parseDailyRow(
  row: Record<string, string>,
  kind: SourceKind,
  convectiveDay: Date,
): StormRecord | null {
  const lat = Number(row.Lat);
  const lng = Number(row.Lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === NULL_ISLAND && lng === NULL_ISLAND) return null;

  const hhmm = row.Time?.trim();
  if (!hhmm || !/^\d{3,4}$/.test(hhmm)) return null;
  const minutes = Number(hhmm.slice(-2));
  const hours = Number(hhmm.slice(0, -2));
  if (hours > 23 || minutes > 59) return null;

  const occurredAt = new Date(convectiveDay);
  // Before 1200Z the report belongs to the next calendar day.
  if (Number(hhmm) < CONVECTIVE_DAY_START_HHMM) occurredAt.setUTCDate(occurredAt.getUTCDate() + 1);
  occurredAt.setUTCHours(hours, minutes, 0, 0);

  // Hail sizes arrive in hundredths of an inch; wind speeds are already knots.
  const raw = Number(kind === "hail" ? row.Size : row.Speed);
  const magnitude = Number.isFinite(raw) && raw > 0 ? (kind === "hail" ? raw / 100 : raw) : null;

  const dayKey = isoDay(convectiveDay);
  return {
    kind: kind === "hail" ? StormKind.HAIL : StormKind.WIND,
    occurredAt,
    lat,
    lng,
    magnitude,
    state: row.State?.trim().toUpperCase() || null,
    // No stable id in this feed, so identity is the event's own coordinates.
    sourceKey: `daily:${kind}:${dayKey}:${hhmm}:${lat},${lng}:${magnitude ?? "x"}`,
    source: "daily",
    preliminary: true,
  };
}

/** SPC archive timestamps are CST; convert to a real instant. */
export function parseCstTimestamp(date: string | undefined, time: string | undefined): Date | null {
  if (!date) return null;
  const clock = (time || "00:00:00").slice(0, 8);
  const parsed = new Date(`${date}T${clock}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + CST_OFFSET_HOURS * 3600_000);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// --- CSV ------------------------------------------------------------------

/** Simple, but quoted commas appear in daily report comments, so handle them. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/** Parses a whole small CSV (a daily file) into row objects. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

/**
 * SPC serves an HTML error page with a 200 for some missing files, so a status
 * check is not enough — the body has to look like the CSV we asked for.
 */
export function looksLikeCsv(text: string, expectedHeader: string): boolean {
  const first = text.split(/\r?\n/, 1)[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("<")) return false;
  return first.startsWith(expectedHeader.toLowerCase());
}

export const DAILY_HEADER: Record<SourceKind, string> = {
  hail: "time,size",
  wind: "time,speed",
};
export const TABULAR_HEADER = "om,yr,mo,dy";

// --- Fetching -------------------------------------------------------------

/** SPC is donated infrastructure; a 502 on a large download is worth retrying. */
const FETCH_ATTEMPTS = 3;

export interface FetchResult {
  text: string | null;
  /** Set when the fetch failed outright, as opposed to the file not existing. */
  error: string | null;
}

/**
 * Fetches a CSV, returning null text when the file simply is not published yet.
 * A 404 is an ordinary answer here — SPC has not posted this year's annual file,
 * or nothing was reported on a given day.
 */
export async function fetchCsv(url: string, expectedHeader: string): Promise<FetchResult> {
  let lastError = "";

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": spcUserAgent() } });
      if (res.status === 404) return { text: null, error: null };
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
      } else {
        const text = await res.text();
        // Some missing files come back as an HTML error page with a 200.
        if (!looksLikeCsv(text, expectedHeader)) return { text: null, error: null };
        return { text, error: null };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < FETCH_ATTEMPTS) await sleep(attempt * 2000);
  }

  return { text: null, error: lastError };
}

/** SPC asks for identifiable traffic, same as the OSM services. */
function spcUserAgent(): string {
  const contact = process.env.OSM_CONTACT_EMAIL ?? "unset-contact@example.invalid";
  return `RoofAI-Sheds-StormIngest/0.1 (+${contact})`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The most recent year with a confirmed archive. Probing beats hard-coding: the
 * previous revision pinned 1955-2023 and silently ran two years stale once SPC
 * published 2024 and 2025.
 */
export async function latestArchiveYear(from = new Date().getUTCFullYear()): Promise<number | null> {
  for (let year = from; year >= from - 5; year--) {
    try {
      const res = await fetch(archiveUrl(year, "hail"), {
        method: "GET",
        headers: { "User-Agent": spcUserAgent(), Range: "bytes=0-64" },
      });
      if (res.ok || res.status === 206) return year;
    } catch {
      // Network trouble on the probe: fall through and try the next year down.
    }
  }
  return null;
}

// --- Persistence ----------------------------------------------------------

/** Minimum of the Prisma client surface this module needs, so it stays testable. */
export interface StormStore {
  stormEvent: {
    findMany(args: {
      where: { sourceKey: { in: string[] } };
      select: { sourceKey: true };
    }): Promise<{ sourceKey: string }[]>;
    createMany(args: { data: StormRecord[] }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { preliminary: boolean; occurredAt: { gte: Date; lt: Date } };
    }): Promise<{ count: number }>;
  };
}

/** Inserts a batch, skipping anything already stored. SQLite has no skipDuplicates. */
export async function insertRecords(store: StormStore, batch: StormRecord[]): Promise<number> {
  if (batch.length === 0) return 0;

  const unique = new Map(batch.map((record) => [record.sourceKey, record]));
  const existing = await store.stormEvent.findMany({
    where: { sourceKey: { in: [...unique.keys()] } },
    select: { sourceKey: true },
  });
  for (const row of existing) unique.delete(row.sourceKey);
  if (unique.size === 0) return 0;

  const { count } = await store.stormEvent.createMany({ data: [...unique.values()] });
  return count;
}

/**
 * Drops preliminary rows for a year the confirmed archive now covers.
 *
 * The feeds carry no shared identifier, so the same storm arrives under
 * different keys from the daily feed and the archive. Superseding by year is
 * what stops one event being counted twice once SPC finishes quality control.
 */
export async function supersedePreliminary(store: StormStore, year: number): Promise<number> {
  const { count } = await store.stormEvent.deleteMany({
    where: {
      preliminary: true,
      occurredAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
  });
  return count;
}
