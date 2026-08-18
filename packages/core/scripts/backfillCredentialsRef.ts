import { createDbClient } from "../src/db/client.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {throw new Error("Missing DATABASE_URL");}
  const db = createDbClient(databaseUrl);

  const result = await db.$executeRaw`UPDATE deployments SET credentials_ref = 'env:' || provider`;
  console.log(`Backfilled credentials_ref on ${result} deployment row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
