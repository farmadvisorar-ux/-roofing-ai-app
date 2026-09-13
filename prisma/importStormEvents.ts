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

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

/** SPC republishes these each year; the range in the name is the coverage. */
const SOURCES = {
  hail: process.env.SPC_HAIL_URL ?? "https://www.spc.noaa.gov/wcm/data/1955-2023_hail.csv.zip",
  wind: process.env.SPC_WIND_URL ?? "https://www.spc.noaa.gov/wcm/data/1955-2023_wind.csv.zip",
} as const;

type Kind = keyof typeof SOURCES;

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

  // One source failing must not discard another that already imported — these
  // are large downloads and the run is slow enough that restarting hurts.
  const failures: string[] = [];
  for (const kind of options.kinds) {
    try {
      const csvPath = await ensureCsv(kind, workDir);
      const imported = await importCsv(kind, csvPath, cutoffYear, options);
      console.log(`  ${kind}: ${imported.toLocaleString()} reports`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${kind}: ${message}`);
      console.error(`  ${kind}: FAILED — ${message}`);
    }
  }

  const total = await prisma.stormEvent.count();
  console.log(`StormEvent now holds ${total.toLocaleString()} reports.`);

  if (failures.length > 0) {
    // Non-zero exit so CI notices, but everything that did import is committed.
    console.error(`\n${failures.length} source(s) failed. Re-run to pick them up:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

/** Downloads and unzips a source file unless it is already on disk. */
async function ensureCsv(kind: Kind, workDir: string): Promise<string> {
  const zipPath = join(workDir, `${kind}.csv.zip`);
  const marker = join(workDir, `${kind}.extracted`);

  if (!existsSync(zipPath)) {
    console.log(`  downloading ${SOURCES[kind]}`);
    const { writeFileSync } = await import("node:fs");
    let lastError = "";

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(SOURCES[kind]);
        if (res.ok) {
          writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
          lastError = "";
          break;
        }
        lastError = `${SOURCES[kind]} returned ${res.status}`;
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
    rmSync(join(workDir, kind), { recursive: true, force: true });
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", join(workDir, kind)]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(marker, "");
  }

  const { readdirSync } = await import("node:fs");
  const dir = join(workDir, kind);
  const csv = readdirSync(dir).find((f) => f.endsWith(".csv"));
  if (!csv) throw new Error(`No CSV inside ${zipPath}`);
  return join(dir, csv);
}

/**
 * Streams the CSV rather than loading it — the hail file alone is 41 MB and the
 * point is to keep this runnable on a laptop.
 */
async function importCsv(
  kind: Kind,
  path: string,
  cutoffYear: number,
  options: Options,
): Promise<number> {
  const states = new Set(options.states);
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

  let header: string[] | null = null;
  let batch: {
    kind: "HAIL" | "WIND";
    occurredAt: Date;
    lat: number;
    lng: number;
    magnitude: number | null;
    state: string | null;
    sourceKey: string;
  }[] = [];
  let imported = 0;

  const flush = async () => {
    if (batch.length === 0) return;

    // Re-importing must be idempotent. SQLite has no skipDuplicates, so drop
    // repeats inside the batch and anything already stored before inserting.
    const unique = new Map(batch.map((row) => [row.sourceKey, row]));
    const existing = await prisma.stormEvent.findMany({
      where: { sourceKey: { in: [...unique.keys()] } },
      select: { sourceKey: true },
    });
    for (const row of existing) unique.delete(row.sourceKey);

    if (unique.size > 0) {
      const result = await prisma.stormEvent.createMany({ data: [...unique.values()] });
      imported += result.count;
    }
    batch = [];
  };

  for await (const line of reader) {
    if (!line.trim()) continue;
    const cells = splitCsv(line);
    if (!header) {
      header = cells.map((c) => c.trim().toLowerCase());
      continue;
    }

    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    const year = Number(row.yr);
    if (!Number.isFinite(year) || year < cutoffYear) continue;
    if (states.size > 0 && !states.has(row.st?.toUpperCase() ?? "")) continue;

    const lat = Number(row.slat);
    const lng = Number(row.slon);
    // 0,0 is SPC's "unknown location", not the Gulf of Guinea.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;

    if (options.bounds) {
      const b = options.bounds;
      // Hail up to the search radius outside a territory still falls on roofs
      // inside it, so pad the box rather than clipping at the boundary.
      const pad = 0.25;
      if (lat < b.minLat - pad || lat > b.maxLat + pad) continue;
      if (lng < b.minLng - pad || lng > b.maxLng + pad) continue;
    }

    const occurredAt = new Date(`${row.date}T${(row.time || "00:00:00").slice(0, 8)}Z`);
    if (Number.isNaN(occurredAt.getTime())) continue;

    const magnitude = Number(row.mag);
    batch.push({
      kind: kind === "hail" ? "HAIL" : "WIND",
      occurredAt,
      lat,
      lng,
      magnitude: Number.isFinite(magnitude) && magnitude > 0 ? magnitude : null,
      state: row.st?.toUpperCase() || null,
      // om is SPC's per-year sequence number; pair it with year and kind.
      sourceKey: `${kind}:${year}:${row.om}:${row.date}:${lat},${lng}`,
    });

    if (batch.length >= BATCH_SIZE) await flush();
  }

  await flush();
  return imported;
}

/** SPC files are simple, but a quoted comma in a location name would still break a split(","). */
function splitCsv(line: string): string[] {
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
