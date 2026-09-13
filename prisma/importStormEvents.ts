// Imports NOAA Storm Prediction Center severe-weather reports into StormEvent.
//
// SPC publishes every US hail and wind report since 1955 as a public-domain CSV.
// Holding them locally means scoring a property costs an indexed query instead of
// a third-party API call per address — and hail is the signal that decides which
// roofs are worth knocking on.
//
//   npm run import:storms                  # last 10 years, hail + wind
//   npm run import:storms -- --years 5     # shorter window
//   npm run import:storms -- --state TX    # one state
//   npm run import:storms -- --kind hail
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

/** SPC republishes these each year; the range in the name is the coverage. */
const SOURCES = {
  hail: process.env.SPC_HAIL_URL ?? "https://www.spc.noaa.gov/wcm/data/1955-2023_hail.csv.zip",
  wind: process.env.SPC_WIND_URL ?? "https://www.spc.noaa.gov/wcm/data/1955-2023_wind.csv.zip",
} as const;

type Kind = keyof typeof SOURCES;

const BATCH_SIZE = 2000;

interface Options {
  years: number;
  state: string | null;
  kinds: Kind[];
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const kind = get("--kind");
  return {
    years: Number(get("--years") ?? 10),
    state: get("--state")?.toUpperCase() ?? null,
    kinds: kind === "hail" || kind === "wind" ? [kind] : ["hail", "wind"],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cutoffYear = new Date().getFullYear() - options.years;
  const workDir = join(tmpdir(), "spc-storm-import");
  mkdirSync(workDir, { recursive: true });

  console.log(
    `Importing SPC reports from ${cutoffYear} onwards` +
      `${options.state ? ` for ${options.state}` : ""} (${options.kinds.join(", ")})`,
  );

  for (const kind of options.kinds) {
    const csvPath = await ensureCsv(kind, workDir);
    const imported = await importCsv(kind, csvPath, cutoffYear, options.state);
    console.log(`  ${kind}: ${imported.toLocaleString()} reports`);
  }

  const total = await prisma.stormEvent.count();
  console.log(`StormEvent now holds ${total.toLocaleString()} reports.`);
}

/** Downloads and unzips a source file unless it is already on disk. */
async function ensureCsv(kind: Kind, workDir: string): Promise<string> {
  const zipPath = join(workDir, `${kind}.csv.zip`);
  const marker = join(workDir, `${kind}.extracted`);

  if (!existsSync(zipPath)) {
    console.log(`  downloading ${SOURCES[kind]}`);
    const res = await fetch(SOURCES[kind]);
    if (!res.ok) throw new Error(`${SOURCES[kind]} returned ${res.status}`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
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
  state: string | null,
): Promise<number> {
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
    if (state && row.st?.toUpperCase() !== state) continue;

    const lat = Number(row.slat);
    const lng = Number(row.slon);
    // 0,0 is SPC's "unknown location", not the Gulf of Guinea.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;

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
