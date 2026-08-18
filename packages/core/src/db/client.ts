import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/client.js";

export type DbClient = PrismaClient;

export function createDbClient(connectionString: string): DbClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
