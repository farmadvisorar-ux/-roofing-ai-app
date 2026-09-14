// Pulls SPC's daily preliminary storm reports — the feed you sell fresh hail on.
//
// The confirmed archive runs a year or two behind and the annual preliminary file
// only appears partway into a year, so between the newest annual file and today
// there is a gap that only the daily reports fill. A crew chasing a storm from
// last Tuesday needs exactly that gap.
//
//   npm run import:storms:recent                # catch up on missing days
//   npm run import:storms:recent -- --days 60   # look further back
//   npm run import:storms:recent -- --force     # re-pull days already fetched
//   npm run import:storms:recent -- --kind hail
//
// Safe to run on a cron: each day is recorded once fetched, so a repeat run asks
// only for what it is missing. A day with no reports is still recorded, or a
// genuinely quiet day would be re-requested forever.
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { FOOTPRINT_STATES } from "../src/lib/territories";
import {
  DAILY_HEADER,
  SourceKind,
  StormRecord,
  dailyUrl,
  fetchCsv,
  insertRecords,
  isoDay,
  parseCsv,
  parseDailyRow,
  sleep,
} from "../src/lib/stormIngest";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

/** How far back to look when nothing has been ingested yet. */
const DEFAULT_LOOKBACK_DAYS = 30;
/** Never walk back further than this in one run, however empty the table is. */
const MAX_LOOKBACK_DAYS = 400;
/** SPC is donated infrastructure — one request per second is the polite ceiling. */
const REQUEST_INTERVAL_MS = Number(process.env.SPC_REQUEST_INTERVAL_MS ?? 1000);
/**
 * Today's file is still filling and yesterday's may be, so both are re-fetched
 * on the next run rather than being recorded as done.
 */
const PROVISIONAL_DAYS = 2;

interface Options {
  days: number;
  kinds: SourceKind[];
  force: boolean;
  states: string[];
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const kind = get("--kind");
  const explicitStates = get("--state");
  const days = Number(get("--days") ?? DEFAULT_LOOKBACK_DAYS);

  return {
    days: Math.min(Math.max(1, Number.isFinite(days) ? days : DEFAULT_LOOKBACK_DAYS), MAX_LOOKBACK_DAYS),
    kinds: kind === "hail" || kind === "wind" ? [kind] : ["hail", "wind"],
    force: argv.includes("--force"),
    states: argv.includes("--all-states")
      ? []
      : (explicitStates?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) ?? FOOTPRINT_STATES),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const days = recentDays(options.days);

  console.log(
    `Catching up on SPC daily reports: ${days.length} day(s) back to ${isoDay(days[days.length - 1])}` +
      `${options.states.length ? ` for ${options.states.join(", ")}` : " nationwide"} (${options.kinds.join(", ")})`,
  );

  const alreadyFetched = options.force ? new Set<string>() : await fetchedDays(days);

  let requested = 0;
  let imported = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const day of days) {
    const key = isoDay(day);
    for (const kind of options.kinds) {
      if (alreadyFetched.has(`${key}:${kind}`)) {
        skipped++;
        continue;
      }

      // Space out requests; the loop can span hundreds of files.
      if (requested > 0) await sleep(REQUEST_INTERVAL_MS);
      requested++;

      const { text, error } = await fetchCsv(dailyUrl(day, kind), DAILY_HEADER[kind]);
      if (error) {
        failures.push(`${key} ${kind}: ${error}`);
        continue;
      }

      const records: StormRecord[] = [];
      if (text) {
        for (const row of parseCsv(text)) {
          const record = parseDailyRow(row, kind, day);
          if (!record) continue;
          if (options.states.length > 0 && !options.states.includes(record.state ?? "")) continue;
          records.push(record);
        }
      }

      const added = await insertRecords(prisma, records);
      imported += added;

      // Recent days are still being amended, so don't mark them done yet.
      if (!isProvisional(day)) await markFetched(key, kind, records.length);
      if (added > 0) console.log(`  ${key} ${kind}: ${added} new (${records.length} in footprint)`);
    }
  }

  const total = await prisma.stormEvent.count();
  const preliminary = await prisma.stormEvent.count({ where: { preliminary: true } });
  const newest = await prisma.stormEvent.findFirst({
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true, preliminary: true },
  });

  console.log(
    `\n${requested} file(s) requested, ${skipped} already had, ${imported.toLocaleString()} new reports.`,
  );
  console.log(
    `StormEvent holds ${total.toLocaleString()} reports (${preliminary.toLocaleString()} preliminary)` +
      (newest ? `, newest ${isoDay(newest.occurredAt)}${newest.preliminary ? " (preliminary)" : ""}.` : "."),
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} day(s) failed; re-run to pick them up:`);
    for (const failure of failures.slice(0, 10)) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

/** Newest first, so an interrupted run has still fetched the days that matter most. */
function recentDays(count: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = 0; i < count; i++) days.push(new Date(start - i * 86_400_000));
  return days;
}

function isProvisional(day: Date): boolean {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return (start - day.getTime()) / 86_400_000 < PROVISIONAL_DAYS;
}

async function fetchedDays(days: Date[]): Promise<Set<string>> {
  const rows = await prisma.stormIngestDay.findMany({
    where: { day: { in: days.map(isoDay) } },
    select: { day: true, kind: true },
  });
  return new Set(rows.map((row) => `${row.day}:${row.kind === "HAIL" ? "hail" : "wind"}`));
}

async function markFetched(day: string, kind: SourceKind, reports: number): Promise<void> {
  const stormKind = kind === "hail" ? "HAIL" : "WIND";
  await prisma.stormIngestDay.upsert({
    where: { day_kind: { day, kind: stormKind } },
    create: { day, kind: stormKind, reports },
    update: { reports, fetchedAt: new Date() },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
