import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function databaseName(url: string): string {
  const path = url.split("?")[0];
  return path.substring(path.lastIndexOf("/") + 1);
}

// Runs once before the whole test run: refuse non-test databases, then empty every table.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/lumen_test";
  const name = databaseName(url);
  if (!name.endsWith("_test")) {
    throw new Error("Refusing to run tests: the database name must end with _test, but it is '" + name + "'.");
  }

  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  try {
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'"
    );
    if (rows.length > 0) {
      const names = rows.map(function (r) { return '"' + r.tablename + '"'; }).join(", ");
      await prisma.$executeRawUnsafe("TRUNCATE TABLE " + names + " RESTART IDENTITY CASCADE");
    }
  } finally {
    await prisma.$disconnect();
  }
}
