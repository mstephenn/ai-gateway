import type { DbClient } from "../db/client.js";

export const DEFAULT_ROLES = [
  { name: "platform_admin", description: "Full platform administration" },
  {
    name: "gateway_admin",
    description: "Gateway configuration and deployment administration",
  },
  {
    name: "team_owner",
    description: "Team-level ownership and key management",
  },
  { name: "auditor", description: "Read-only audit and usage access" },
  { name: "end_user", description: "Standard end user" },
];

export async function ensureDefaultRoles(db: DbClient): Promise<void> {
  for (const role of DEFAULT_ROLES) {
    await db.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }
}
