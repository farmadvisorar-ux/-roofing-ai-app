// Imports NOAA Storm Prediction Center severe-weather reports into StormEvent.
//
// SPC publishes every US hail and wind report since 1955 as a public-domain CSV.
// Holding them locally means scoring a property costs an indexed query instead of
// a third-party API call per address — and hail is the signal that decides which
// roofs are worth knocking on.
//
//   npm run import:storms                        # the whole service footprint
//   npm run import:storms -- --years 5           # shorter window
//   npm run import:storms -- --state TX,LA       # explicit states
//   npm run import:storms -- --territory east-texas
//   npm run import:storms -- --all-states        # nationwide
//   npm run import:storms -- --kind hail
//
// With no --state, --territory or --all-states, the import is scoped to the
// states in src/lib/territories.ts — the regions we actually sell into. There is
// no value in carrying Montana hail in a Texas and Louisiana database.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { FOOTPRINT_STATES, TERRITORY_IDS, getTerritory } from "../src/lib/territories";
import type { GeoBounds } from "../src/lib/geo";
import {
  SourceKind,
  StormRecord,
  TABULAR_HEADER,
  annualUrl,
  archiveUrl,
  fetchCsv,
  insertRecords,
  latestArchiveYear,
  parseArchiveRow,
  parseCsv,
  splitCsvLine,
  supersedePreliminary,
} from "../src/lib/stormIngest";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

type Kind = SourceKind;

/**
 * The confirmed archive year is discovered rather than pinned. An earlier
 * revision hard-coded 1955-2023 and went quietly two years stale the moment SPC
 * published 2024 and 2025.
 */
async function archiveSource(kind: Kind, year: number): Promise<string> {
  return process.env[kind === "hail" ? "SPC_HAIL_URL" : "SPC_WIND_URL"] ?? archiveUrl(year, kind);
}

const BATCH_SIZE = 2000;
/** SPC is donated infrastructure; a 502 on a 10 MB download is worth retrying. */
const DOWNLOAD_ATTEMPTS = 4;

interface Options {
  years: number;
  /** Empty means no state filter. */
  states: string[];
  bounds: GeoBounds | null;
  scope: string;
  kinds: Kind[];
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const kind = get("--kind");
  const kinds: Kind[] = kind === "hail" || kind === "wind" ? [kind] : ["hail", "wind"];
  const years = Number(get("--years") ?? 10);

  const territoryId = get("--territory");
  if (territoryId) {
    const territory = getTerritory(territoryId);
    if (!territory) {
      throw new Error(`Unknown territory "${territoryId}". Known: ${TERRITORY_IDS.join(", ")}`);
    }
    return {
      years,
      states: territory.states,
      bounds: territory.bounds,
      scope: territory.name,
      kinds,
    };
  }

  const explicit = get("--state");
  if (explicit) {
    const states = explicit
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return { years, states, bounds: null, scope: states.join(", "), kinds };
  }

  if (argv.includes("--all-states")) {
    return { years, states: [], bounds: null, scope: "nationwide", kinds };
  }

  return {
    years,
    states: FOOTPRINT_STATES,
    bounds: null,
    scope: `service footprint (${FOOTPRINT_STATES.join(", ")})`,
    kinds,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cutoffYear = new Date().getFullYear() - options.years;
  const workDir = join(tmpdir(), "spc-storm-import");
  mkdirSync(workDir, { recursive: true });

  console.log(
    `Importing SPC reports from ${cutoffYear} onwards for ${options.scope} (${options.kinds.join(", ")})`,
  );

  const archiveYear = await latestArchiveYear();
  if (archiveYear === null) {
    console.error("Could not reach SPC to find the confirmed archive. Check connectivity.");
    process.exitCode = 1;
    return;
  }
  console.log(`  confirmed archive covers through ${archiveYear}`);

  const failures: string[] = [];

  // Tier 1: the quality-controlled archive.
  for (const kind of options.kinds) {
    try {
      const csvPath = await ensureCsv(kind, archiveYear, workDir);
      const imported = await importArchiveCsv(kind, csvPath, cutoffYear, options);
      console.log(`  ${kind} archive: ${imported.toLocaleString()} reports`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${kind} archive: ${message}`);
      console.error(`  ${kind} archive: FAILED — ${message}`);
    }
  }

  // Anything the archive now covers must not also be counted as preliminary.
  for (let year = cutoffYear; year <= archiveYear; year++) {
    const dropped = await supersedePreliminary(prisma, year);
    if (dropped > 0) {
      console.log(`  superseded ${dropped.toLocaleString()} preliminary reports for ${year}`);
    }
  }

  // Tier 2: annual preliminary files for years the archive has not reached.
  const thisYear = new Date().getUTCFullYear();
  for (let year = archiveYear + 1; year <= thisYear; year++) {
    for (const kind of options.kinds) {
      try {
        const imported = await importAnnualPreliminary(kind, year, options);
        if (imported === null) {
          console.log(`  ${kind} ${year}: no annual file published yet — use import:storms:recent`);
        } else {
          console.log(`  ${kind} ${year} preliminary: ${imported.toLocaleString()} reports`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${kind} ${year}: ${message}`);
        console.error(`  ${kind} ${year}: FAILED — ${message}`);
      }
    }
  }

  const total = await prisma.stormEvent.count();
  const preliminary = await prisma.stormEvent.count({ where: { preliminary: true } });
  console.log(
    `StormEvent now holds ${total.toLocaleString()} reports (${preliminary.toLocaleString()} preliminary).`,
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} source(s) failed. Re-run to pick them up:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

/**
 * Annual preliminary files are plain CSV and small enough to hold in memory —
 * this year so far, not seventy years of history.
 */
async function importAnnualPreliminary(
  kind: Kind,
  year: number,
  options: Options,
): Promise<number | null> {
  const { text, error } = await fetchCsv(annualUrl(year, kind), TABULAR_HEADER);
  if (error) throw new Error(error);
  if (!text) return null;

  const records: StormRecord[] = [];
  for (const row of parseCsv(text)) {
    const record = parseArchiveRow(row, kind, "annual");
    if (record && keep(record, options)) records.push(record);
  }
  return insertRecords(prisma, records);
}

/** Shared filter: the state list and, for a territory import, its padded bounds. */
function keep(record: StormRecord, options: Options): boolean {
  if (options.states.length > 0 && !options.states.includes(record.state ?? "")) return false;
  if (options.bounds) {
    const b = options.bounds;
    // Hail up to the search radius outside a territory still falls on roofs
    // inside it, so pad the box rather than clipping at the boundary.
    const pad = 0.25;
    if (record.lat < b.minLat - pad || record.lat > b.maxLat + pad) return false;
    if (record.lng < b.minLng - pad || record.lng > b.maxLng + pad) return false;
  }
  return true;
}

/** Downloads and unzips a source file unless it is already on disk. */
async function ensureCsv(kind: Kind, year: number, workDir: string): Promise<string> {
  const url = await archiveSource(kind, year);
  const zipPath = join(workDir, `${kind}-${year}.csv.zip`);
  const marker = join(workDir, `${kind}-${year}.extracted`);

  if (!existsSync(zipPath)) {
    console.log(`  downloading ${url}`);
    const { writeFileSync } = await import("node:fs");
    let lastError = "";

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
          lastError = "";
          break;
        }
        lastError = `${url} returned ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < DOWNLOAD_ATTEMPTS) {
        const wait = attempt * 4000;
        console.log(`    attempt ${attempt} failed (${lastError}); retrying in ${wait / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    if (lastError) throw new Error(lastError);
  }

  if (!existsSync(marker)) {
    rmSync(join(workDir, `${kind}-${year}`), { recursive: true, force: true });
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", join(workDir, `${kind}-${year}`)]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(marker, "");
  }

  const { readdirSync } = await import("node:fs");
  const dir = join(workDir, `${kind}-${year}`);
  const csv = readdirSync(dir).find((f) => f.endsWith(".csv"));
  if (!csv) throw new Error(`No CSV inside ${zipPath}`);
  return join(dir, csv);
}

/**
 * Streams the archive rather than loading it — the hail file alone is 41 MB and
 * the point is to keep this runnable on a laptop. Rows go through the same
 * parser the annual preliminary tier uses, so the two feeds cannot drift on how
 * a timestamp or a magnitude is read.
 */
async function importArchiveCsv(
  kind: Kind,
  path: string,
  cutoffYear: number,
  options: Options,
): Promise<number> {
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

  let header: string[] | null = null;
  let batch: StormRecord[] = [];
  let imported = 0;

  const flush = async () => {
    imported += await insertRecords(prisma, batch);
    batch = [];
  };

  for await (const line of reader) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    if (!header) {
      header = cells.map((c) => c.trim().toLowerCase());
      continue;
    }

    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    // Cheap rejections before the full parse: the file is 400,000 rows.
    const year = Number(row.yr);
    if (!Number.isFinite(year) || year < cutoffYear) continue;
    if (options.states.length > 0 && !options.states.includes(row.st?.toUpperCase() ?? "")) continue;

    const record = parseArchiveRow(row, kind, "archive");
    if (!record || !keep(record, options)) continue;

    batch.push(record);
    if (batch.length >= BATCH_SIZE) await flush();
  }

  await flush();
  return imported;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
