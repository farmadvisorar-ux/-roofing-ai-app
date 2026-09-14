import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { calculateShedPrice, DEFAULT_SHED_CONFIG } from "../src/lib/shed";
import { estimateMidpoint, estimateRoof } from "../src/lib/roofing";
import { territoryIdForPoint } from "../src/lib/territories";

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
    // One roof per region, so the footprint is populated end to end and the
    // coverage view is not a list of zeroes. Coordinates are real; the owner
    // names are invented sample data, as with the contacts above.
    {
      lat: 30.5083,
      lng: -97.6789,
      state: "TX",
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
      linkToContactName: "Priya Natarajan",
    },
    {
      lat: 32.7767,
      lng: -96.797,
      address: "3401 Live Oak St",
      city: "Dallas",
      state: "TX",
      zip: "75204",
      facts: { footprintSqFt: 2250, buildingLevels: 1, roofShape: "hipped", roofMaterial: "asphalt_shingle" },
      ownerName: "OKONKWO, ADAEZE",
      yearBuilt: 1991,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 32.3513,
      lng: -95.3011,
      address: "915 S Broadway Ave",
      city: "Tyler",
      state: "TX",
      zip: "75701",
      facts: { footprintSqFt: 1780, buildingLevels: 1, roofShape: "gabled", roofMaterial: "asphalt_shingle" },
      ownerName: "WHITFIELD, DARNELL",
      yearBuilt: 1986,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 31.9973,
      lng: -102.0779,
      address: "2200 W Wall St",
      city: "Midland",
      state: "TX",
      zip: "79701",
      facts: { footprintSqFt: 2600, buildingLevels: 1, roofShape: "hipped", roofMaterial: "asphalt_shingle" },
      ownerName: "BRENNAN, KATHLEEN",
      yearBuilt: 2004,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 29.4241,
      lng: -98.4936,
      address: "618 Nolan St",
      city: "San Antonio",
      state: "TX",
      zip: "78202",
      facts: { footprintSqFt: 1480, buildingLevels: 1, roofShape: "gabled", roofMaterial: "roof_tiles" },
      ownerName: "SALAZAR, RUBEN",
      yearBuilt: 1972,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 32.5252,
      lng: -93.7502,
      address: "1801 Fairfield Ave",
      city: "Shreveport",
      state: "LA",
      zip: "71101",
      facts: { footprintSqFt: 2050, buildingLevels: 2, roofShape: "hipped", roofMaterial: "asphalt_shingle" },
      ownerName: "THIBODEAUX, MARIE",
      yearBuilt: 1968,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 30.4515,
      lng: -91.1871,
      address: "2255 Government St",
      city: "Baton Rouge",
      state: "LA",
      zip: "70806",
      facts: { footprintSqFt: 1890, buildingLevels: 1, roofShape: "hipped", roofMaterial: "asphalt_shingle" },
      ownerName: "LANDRY, CEDRIC",
      yearBuilt: 1979,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 29.9511,
      lng: -90.0715,
      address: "1436 Magazine St",
      city: "New Orleans",
      state: "LA",
      zip: "70130",
      facts: { footprintSqFt: 2340, buildingLevels: 2, roofShape: "gabled", roofMaterial: "slate" },
      ownerName: "DUPLESSIS, YVONNE",
      yearBuilt: 1912,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 32.4085,
      lng: -91.1868,
      address: "402 N Cedar St",
      city: "Tallulah",
      state: "LA",
      zip: "71282",
      facts: { footprintSqFt: 1520, buildingLevels: 1, roofShape: "gabled", roofMaterial: "metal" },
      ownerName: "JEFFERSON, MALIK",
      yearBuilt: 1988,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
    },
    {
      lat: 30.2266,
      lng: -93.2174,
      address: "710 Ryan St",
      city: "Lake Charles",
      state: "LA",
      zip: "70601",
      facts: { footprintSqFt: 1620, buildingLevels: 1, roofShape: "gabled", roofMaterial: "asphalt_shingle" },
      ownerName: "BOUDREAUX, ANTOINE",
      yearBuilt: 1994,
      status: "ENRICHED" as const,
      sources: "parcel,overpass,nominatim",
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
        territory: territoryIdForPoint({ lat: sample.lat, lng: sample.lng }, sample.state),
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
