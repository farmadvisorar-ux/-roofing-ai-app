import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { calculateShedPrice, DEFAULT_SHED_CONFIG } from "../src/lib/shed";
import { estimateMidpoint, estimateRoof } from "../src/lib/roofing";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  await seedLeads();
  await seedProperties();
}

async function seedLeads() {
  const existing = await prisma.contact.count();
  if (existing > 0) {
    console.log("Leads already seeded, skipping.");
    return;
  }

  const samples = [
    {
      name: "Maria Alvarez",
      email: "maria.alvarez@example.com",
      phone: "555-201-3344",
      address: "412 Birchwood Ln",
      city: "Round Rock",
      state: "TX",
      zip: "78664",
      stage: "QUOTED" as const,
      config: { ...DEFAULT_SHED_CONFIG, widthFt: 12, lengthFt: 16, roofStyle: "GAMBREL" as const },
    },
    {
      name: "Devon Carter",
      email: "devon.carter@example.com",
      phone: "555-778-2210",
      address: "88 Prairie View Dr",
      city: "Georgetown",
      state: "TX",
      zip: "78626",
      stage: "NEW" as const,
      config: { ...DEFAULT_SHED_CONFIG, widthFt: 10, lengthFt: 10 },
    },
    {
      name: "Priya Natarajan",
      email: "priya.n@example.com",
      phone: "555-460-9981",
      address: "27 Sunset Ridge",
      city: "Cedar Park",
      state: "TX",
      zip: "78613",
      stage: "NEGOTIATING" as const,
      config: { ...DEFAULT_SHED_CONFIG, widthFt: 14, lengthFt: 20, wallHeightFt: 9, roofStyle: "GABLE" as const },
    },
  ];

  for (const sample of samples) {
    const { config, ...contactAndStage } = sample;
    const price = calculateShedPrice(config);
    const contact = await prisma.contact.create({
      data: {
        name: contactAndStage.name,
        email: contactAndStage.email,
        phone: contactAndStage.phone,
        address: contactAndStage.address,
        city: contactAndStage.city,
        state: contactAndStage.state,
        zip: contactAndStage.zip,
      },
    });

    await prisma.lead.create({
      data: {
        contactId: contact.id,
        stage: contactAndStage.stage,
        source: "CONFIGURATOR",
        estimatedValue: price,
        shedConfig: {
          create: { ...config, price },
        },
      },
    });
  }

  console.log(`Seeded ${samples.length} sample leads.`);
}

/**
 * A few pins for the canvassing map, in the same Round Rock / Georgetown area as
 * the sample leads, covering each state the map colour-codes: never looked up,
 * address only, fully enriched, and one already worked into the pipeline.
 *
 * The owner names here are invented sample data, like the contacts above — the
 * real pipeline only ever fills ownerName from a county parcel record.
 */
async function seedProperties() {
  if ((await prisma.property.count()) > 0) {
    console.log("Properties already seeded, skipping.");
    return;
  }

  const samples = [
    {
      lat: 30.5083,
      lng: -97.6789,
      notes: "Curling shingles visible from the street.",
      facts: {},
      status: "PENDING" as const,
      sources: null,
    },
    {
      lat: 30.5091,
      lng: -97.6802,
      address: "1204 Chisholm Trail",
      city: "Round Rock",
      state: "TX",
      zip: "78681",
      facts: { footprintSqFt: 1950, buildingLevels: 1, roofShape: "gabled", roofMaterial: "asphalt_shingle" },
      ownerName: "GARZA, LUIS & ANA",
      parcelId: "R-0421-9930",
      yearBuilt: 1998,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 30.5075,
      lng: -97.6771,
      address: "908 Sam Bass Rd",
      city: "Round Rock",
      state: "TX",
      zip: "78681",
      facts: { footprintSqFt: 2400, buildingLevels: 2, roofShape: "hipped" },
      status: "PARTIAL" as const,
      sources: "overpass,nominatim",
    },
    {
      lat: 30.6329,
      lng: -97.6772,
      address: "27 Sunset Ridge",
      city: "Georgetown",
      state: "TX",
      zip: "78626",
      facts: { footprintSqFt: 3100, buildingLevels: 2, roofShape: "gambrel", roofMaterial: "metal" },
      ownerName: "NATARAJAN, PRIYA",
      status: "ENRICHED" as const,
      sources: "parcel,overpass",
      // Linked below to the existing sample lead of the same name.
      linkToContactName: "Priya Natarajan",
    },
  ];

  for (const sample of samples) {
    const { facts, status, sources, linkToContactName, ...rest } = sample;
    const hasFacts = Object.keys(facts).length > 0;
    const estimate = hasFacts ? estimateRoof(facts) : null;

    const lead = linkToContactName
      ? await prisma.lead.findFirst({ where: { contact: { name: linkToContactName } } })
      : null;

    await prisma.property.create({
      data: {
        ...rest,
        ...facts,
        enrichmentStatus: status,
        enrichmentSources: sources,
        enrichedAt: status === "PENDING" ? null : new Date(),
        ...(estimate
          ? {
              roofSqFt: estimate.roofSqFt,
              roofSquares: estimate.roofSquares,
              estimateLow: estimate.estimateLow,
              estimateHigh: estimate.estimateHigh,
            }
          : {}),
        ...(lead ? { leadId: lead.id } : {}),
      },
    });

    // Keep the linked lead's pipeline value consistent with the roof estimate.
    if (lead && estimate) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { estimatedValue: estimateMidpoint(estimate) },
      });
    }
  }

  console.log(`Seeded ${samples.length} sample properties.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
