import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { calculateShedPrice, DEFAULT_SHED_CONFIG } from "../src/lib/shed";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.contact.count();
  if (existing > 0) {
    console.log("Database already seeded, skipping.");
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
