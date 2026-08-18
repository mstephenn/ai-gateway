import type {
  DirectoryProvider,
  DirectorySnapshot,
  DirectoryUser,
  SyncChange,
  SyncRunResult,
} from "./types.js";
import type { DbClient } from "../db/client.js";
import type { DirectorySyncConfig } from "../db/generated/client.js";

export interface SyncOptions {
  apply?: boolean;
}

interface GroupMapping {
  orgUnitId: string;
  roleId: string;
}

interface ExistingUser {
  id: string;
  externalId: string | null;
  email: string;
  name: string | null;
  status: string;
  source: string;
  memberships: Array<{ id: string; orgUnitId: string; roleId: string }>;
}

function parseGroupMappings(value: unknown): Record<string, GroupMapping> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, GroupMapping>;
}

function desiredMemberships(
  user: DirectoryUser,
  mappings: Record<string, GroupMapping>,
): Array<{ orgUnitId: string; roleId: string }> {
  const set = new Map<string, { orgUnitId: string; roleId: string }>();
  for (const groupId of user.groupIds) {
    const mapping = mappings[groupId];
    if (mapping) {
      set.set(mapping.orgUnitId, mapping);
    }
  }
  return Array.from(set.values());
}

export async function computeDiff(
  db: DbClient,
  config: DirectorySyncConfig,
  snapshot: DirectorySnapshot,
): Promise<SyncChange[]> {
  const mappings = parseGroupMappings(config.groupMappings);
  const mappingOrgUnitIds = new Set(
    Object.values(mappings).map((m) => m.orgUnitId),
  );

  const existingRows = (await db.user.findMany({
    where: { externalId: { not: null } },
    include: { memberships: true },
  })) as ExistingUser[];

  const existingByExternalId = new Map<string, ExistingUser>();
  for (const row of existingRows) {
    if (row.externalId) {
      existingByExternalId.set(row.externalId, row);
    }
  }

  const directoryExternalIds = new Set(snapshot.users.map((u) => u.externalId));
  const changes: SyncChange[] = [];

  for (const dirUser of snapshot.users) {
    const existing = existingByExternalId.get(dirUser.externalId);

    if (!existing) {
      changes.push({
        action: "create_user",
        userEmail: dirUser.email,
        oldValues: {},
        newValues: {
          email: dirUser.email,
          name: dirUser.name,
          externalId: dirUser.externalId,
        },
      });
    } else {
      if (existing.name !== dirUser.name) {
        changes.push({
          action: "update_user",
          userEmail: existing.email,
          oldValues: { name: existing.name },
          newValues: { name: dirUser.name },
        });
      }
      if (existing.status !== "active") {
        changes.push({
          action: "update_user",
          userEmail: existing.email,
          oldValues: { status: existing.status },
          newValues: { status: "active" },
        });
      }
    }

    const desired = desiredMemberships(dirUser, mappings);
    const existingMemberships =
      existing?.memberships.filter((m) => mappingOrgUnitIds.has(m.orgUnitId)) ??
      [];

    for (const d of desired) {
      const has = existingMemberships.some(
        (m) => m.orgUnitId === d.orgUnitId && m.roleId === d.roleId,
      );
      if (!has) {
        changes.push({
          action: "add_membership",
          userEmail: existing?.email ?? dirUser.email,
          oldValues: {},
          newValues: { orgUnitId: d.orgUnitId, roleId: d.roleId },
        });
      }
    }

    if (existing) {
      for (const m of existingMemberships) {
        const stillDesired = desired.some(
          (d) => d.orgUnitId === m.orgUnitId && d.roleId === m.roleId,
        );
        if (!stillDesired) {
          changes.push({
            action: "remove_membership",
            userEmail: existing.email,
            oldValues: { orgUnitId: m.orgUnitId, roleId: m.roleId },
            newValues: {},
          });
        }
      }
    }
  }

  for (const existing of existingRows) {
    if (
      !directoryExternalIds.has(existing.externalId!) &&
      existing.status === "active"
    ) {
      changes.push({
        action: "disable_user",
        userEmail: existing.email,
        oldValues: { status: existing.status },
        newValues: { status: "inactive" },
      });
    }
  }

  return changes;
}

export async function applyChanges(
  db: DbClient,
  config: DirectorySyncConfig,
  changes: SyncChange[],
): Promise<void> {
  const mappings = parseGroupMappings(config.groupMappings);
  const mappingOrgUnitIds = new Set(
    Object.values(mappings).map((m) => m.orgUnitId),
  );

  for (const change of changes) {
    try {
      switch (change.action) {
        case "create_user": {
          const email = String(change.newValues.email ?? change.userEmail);
          const existingByEmail = await db.user.findUnique({
            where: { email },
          });
          if (existingByEmail) {
            await db.user.update({
              where: { id: existingByEmail.id },
              data: {
                name: change.newValues.name
                  ? String(change.newValues.name)
                  : existingByEmail.name,
                externalId: String(change.newValues.externalId),
                source:
                  existingByEmail.source === "manual" ? "linked" : "directory",
                status: "active",
              },
            });
          } else {
            await db.user.create({
              data: {
                email,
                name: change.newValues.name
                  ? String(change.newValues.name)
                  : null,
                externalId: String(change.newValues.externalId),
                organizationId: config.organizationId,
                source: "directory",
                status: "active",
              },
            });
          }
          break;
        }
        case "update_user": {
          const user = await db.user.findUnique({
            where: { email: change.userEmail },
          });
          if (user) {
            const data: any = {};
            if (change.newValues.name !== undefined) {
              data.name = change.newValues.name
                ? String(change.newValues.name)
                : null;
            }
            if (change.newValues.status !== undefined) {
              data.status = String(change.newValues.status);
            }
            await db.user.update({ where: { id: user.id }, data });
          }
          break;
        }
        case "disable_user": {
          const user = await db.user.findUnique({
            where: { email: change.userEmail },
          });
          if (user) {
            await db.user.update({
              where: { id: user.id },
              data: { status: "inactive" },
            });
          }
          break;
        }
        case "add_membership": {
          const user = await db.user.findUnique({
            where: { email: change.userEmail },
          });
          if (user) {
            await db.membership.upsert({
              where: {
                userId_orgUnitId: {
                  userId: user.id,
                  orgUnitId: String(change.newValues.orgUnitId),
                },
              },
              update: { roleId: String(change.newValues.roleId) },
              create: {
                userId: user.id,
                orgUnitId: String(change.newValues.orgUnitId),
                roleId: String(change.newValues.roleId),
              },
            });
          }
          break;
        }
        case "remove_membership": {
          const user = await db.user.findUnique({
            where: { email: change.userEmail },
          });
          if (user) {
            const membership = await db.membership.findUnique({
              where: {
                userId_orgUnitId: {
                  userId: user.id,
                  orgUnitId: String(change.oldValues.orgUnitId),
                },
              },
            });
            if (membership && mappingOrgUnitIds.has(membership.orgUnitId)) {
              await db.membership.delete({ where: { id: membership.id } });
            }
          }
          break;
        }
      }
    } catch (err) {
      // Individual change failures are logged; continue with remaining changes.
      // A production implementation would record per-change errors in the change row.
      console.error("Directory sync change failed:", change, err);
    }
  }
}

export async function runSync(
  db: DbClient,
  config: DirectorySyncConfig,
  provider: DirectoryProvider,
  options: SyncOptions = {},
): Promise<SyncRunResult> {
  try {
    const snapshot = await provider.fetchDirectory();
    const changes = await computeDiff(db, config, snapshot);

    if (options.apply) {
      await applyChanges(db, config, changes);
    }

    return { status: "completed", changes };
  } catch (err) {
    return {
      status: "failed",
      changes: [],
      error: err instanceof Error ? err.message : "unknown_error",
    };
  }
}
