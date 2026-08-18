import type {
  AdminDirectorySyncConfigDto,
  AdminDirectorySyncRunDto,
  AdminMembershipDto,
  AdminOrganizationDto,
  AdminOrgUnitDto,
  AdminRoleDto,
  AdminUserDto,
  CreateMembershipRequest,
  CreateDirectorySyncConfigRequest,
  CreateOrgUnitRequest,
  CreateUserRequest,
  UpdateDirectorySyncConfigRequest,
  UpdateOrganizationRequest,
  UpdateUserRequest,
} from "@ai-gateway/shared";
import {
  entraConfig as entraSeed,
  organization as orgSeed,
  orgUnits as unitSeed,
  syncHistory as historySeed,
  syncPreview,
  users as userSeed,
} from "../mock-data/fixtures";
import type {
  EntraConfig,
  Organization,
  OrgUnit,
  SyncPreviewEntry,
  SyncRun,
  User,
} from "../mock-data/types";
import { apiList, apiRequest, hasBackendApi, nextId, nowIso, simulate } from "./client";

let org: Organization = { ...orgSeed };
let units: OrgUnit[] = [...unitSeed];
let userStore: User[] = [...userSeed];
let entra: EntraConfig = { ...entraSeed, mappings: [...entraSeed.mappings] };
let history: SyncRun[] = [...historySeed];

function fromOrganization(row: AdminOrganizationDto): Organization {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain ?? "",
    defaultRegion: "",
    contactEmail: "",
    configured: true,
  };
}

function toOrganization(input: Omit<Organization, "id">): UpdateOrganizationRequest {
  return {
    name: input.name,
    domain: input.domain || null,
  };
}

function fromOrgUnit(row: AdminOrgUnitDto): OrgUnit {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    type: row.type,
    teamId: row.teamId,
  };
}

function toUserStatus(status: User["status"]): AdminUserDto["status"] {
  return status === "deactivated" ? "inactive" : "active";
}

function fromUserStatus(status: AdminUserDto["status"]): User["status"] {
  return status === "inactive" ? "deactivated" : "active";
}

function fromUserSource(source: AdminUserDto["source"]): User["source"] {
  return source === "directory" ? "entra" : "manual";
}

function roleFromMembership(membership?: AdminMembershipDto): User["role"] {
  const role = membership?.role?.name;
  if (role === "platform_admin") return "owner";
  if (role === "gateway_admin" || role === "team_owner") return "admin";
  if (role === "end_user") return "developer";
  if (role === "auditor") return "viewer";
  if (role === "owner" || role === "admin" || role === "developer" || role === "viewer")
    return role;
  return "developer";
}

function fromUser(row: AdminUserDto, memberships: AdminMembershipDto[] = []): User {
  const membership = memberships.find((entry) => entry.userId === row.id);
  return {
    id: row.id,
    name: row.name ?? row.email,
    email: row.email,
    role: roleFromMembership(membership),
    teamId: membership?.orgUnit?.teamId ?? "",
    status: fromUserStatus(row.status),
    source: fromUserSource(row.source),
    lastLoginAt: null,
  };
}

function toUser(
  input: UserInput,
  organizationId?: string | null,
): CreateUserRequest | UpdateUserRequest {
  return {
    email: input.email,
    name: input.name,
    status: toUserStatus(input.status),
    source: "manual",
    organizationId,
  };
}

function backendRoleName(role: User["role"]): string {
  if (role === "owner") return "platform_admin";
  if (role === "admin") return "gateway_admin";
  if (role === "viewer") return "auditor";
  return "end_user";
}

async function syncMembership(userId: string, input: UserInput): Promise<AdminMembershipDto[]> {
  const [roles, orgUnits, memberships] = await Promise.all([
    apiList<AdminRoleDto>("/admin/roles"),
    apiList<AdminOrgUnitDto>("/admin/org-units"),
    apiList<AdminMembershipDto>("/admin/memberships", { query: { userId } }),
  ]);
  const role =
    roles.find((candidate) => candidate.name === backendRoleName(input.role)) ?? roles[0];
  const orgUnit = orgUnits.find(
    (candidate) => candidate.teamId === input.teamId || candidate.id === input.teamId,
  );
  if (!role || !orgUnit) return memberships;

  const existing = memberships[0];
  if (existing?.orgUnitId === orgUnit.id && existing.roleId === role.id) {
    return memberships;
  }
  await Promise.all(
    memberships.map((membership) =>
      apiRequest<void>(`/admin/memberships/${membership.id}`, { method: "DELETE" }),
    ),
  );
  const body: CreateMembershipRequest = { userId, orgUnitId: orgUnit.id, roleId: role.id };
  const created = await apiRequest<AdminMembershipDto>("/admin/memberships", {
    method: "POST",
    body,
  });
  return [created];
}

function mappingEntries(config: AdminDirectorySyncConfigDto): EntraConfig["mappings"] {
  return Object.entries(config.groupMappings ?? {}).map(([groupObjectId, mapping]) => ({
    id: groupObjectId,
    groupObjectId,
    groupName: groupObjectId,
    teamId: mapping.orgUnitId,
    role: "developer",
  }));
}

function fromEntraConfig(config?: AdminDirectorySyncConfigDto): EntraConfig {
  if (!config) {
    return { tenantId: "", clientId: "", enabled: false, mappings: [] };
  }
  return {
    tenantId: config.tenantId,
    clientId: config.clientId,
    enabled: true,
    mappings: mappingEntries(config),
  };
}

function fromSyncRun(row: AdminDirectorySyncRunDto): SyncRun {
  const summary =
    row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
      ? row.summary
      : {};
  const added = Number(summary["create_user"] ?? 0);
  const updated = Number(summary["update_user"] ?? 0);
  const deactivated = Number(summary["disable_user"] ?? 0);
  const durationMs =
    row.startedAt && row.completedAt ? Date.parse(row.completedAt) - Date.parse(row.startedAt) : 0;
  return {
    id: row.id,
    startedAt: row.startedAt ?? row.createdAt,
    durationMs,
    triggeredBy: "platform-admin",
    status: row.status === "failed" ? "failed" : row.status === "completed" ? "success" : "partial",
    added,
    updated,
    deactivated,
  };
}

async function getFirstOrganization(): Promise<Organization | null> {
  try {
    return fromOrganization(await apiRequest<AdminOrganizationDto>("/admin/organization"));
  } catch {
    return null;
  }
}

export function getOrganization(): Promise<Organization> {
  if (hasBackendApi()) {
    return getFirstOrganization().then(
      (backendOrg) => backendOrg ?? { ...orgSeed, configured: false },
    );
  }
  return simulate({ ...org });
}

export function updateOrganization(input: Omit<Organization, "id">): Promise<Organization> {
  if (hasBackendApi()) {
    const body = toOrganization(input);
    return apiRequest<AdminOrganizationDto>("/admin/organization", {
      method: "PATCH",
      body,
    })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("organization not found")) {
          return apiRequest<AdminOrganizationDto>("/admin/organization", { method: "POST", body });
        }
        throw err;
      })
      .then(fromOrganization);
  }
  org = { ...org, ...input, configured: true };
  return simulate({ ...org });
}

export function listOrgUnits(): Promise<OrgUnit[]> {
  if (hasBackendApi()) {
    return apiList<AdminOrgUnitDto>("/admin/org-units").then((rows) => rows.map(fromOrgUnit));
  }
  return simulate(units.map((u) => ({ ...u })));
}

export function createOrgUnit(name: string, parentId: string): Promise<OrgUnit> {
  if (hasBackendApi()) {
    return getFirstOrganization().then((backendOrg) => {
      if (!backendOrg) throw new Error("Organization must be created before adding org units.");
      const body: CreateOrgUnitRequest = {
        organizationId: backendOrg.id,
        type: parentId ? "department" : "root",
        name,
        parentId: parentId || null,
      };
      return apiRequest<AdminOrgUnitDto>("/admin/org-units", { method: "POST", body }).then(
        fromOrgUnit,
      );
    });
  }
  const unit: OrgUnit = { id: nextId("ou"), name, parentId };
  units = [...units, unit];
  return simulate(unit);
}

export function listUsers(): Promise<User[]> {
  if (hasBackendApi()) {
    return Promise.all([
      apiList<AdminUserDto>("/admin/users"),
      apiList<AdminMembershipDto>("/admin/memberships").catch(() => []),
    ]).then(([rows, memberships]) => rows.map((row) => fromUser(row, memberships)));
  }
  return simulate(userStore.map((u) => ({ ...u })));
}

export type UserInput = Omit<User, "id" | "lastLoginAt" | "source">;

export function createUser(input: UserInput): Promise<User> {
  if (hasBackendApi()) {
    return getFirstOrganization().then((backendOrg) =>
      apiRequest<AdminUserDto>("/admin/users", {
        method: "POST",
        body: toUser(input, backendOrg?.id ?? null),
      }).then(async (row) => fromUser(row, await syncMembership(row.id, input))),
    );
  }
  const user: User = { ...input, id: nextId("usr"), source: "manual", lastLoginAt: null };
  userStore = [user, ...userStore];
  return simulate(user);
}

export function updateUser(id: string, input: UserInput): Promise<User> {
  if (hasBackendApi()) {
    return apiRequest<AdminUserDto>(`/admin/users/${id}`, {
      method: "PATCH",
      body: toUser(input),
    }).then(async (row) => fromUser(row, await syncMembership(row.id, input)));
  }
  const existing = userStore.find((u) => u.id === id);
  const updated: User = {
    ...input,
    id,
    source: existing?.source ?? "manual",
    lastLoginAt: existing?.lastLoginAt ?? null,
  };
  userStore = userStore.map((u) => (u.id === id ? updated : u));
  return simulate(updated);
}

export function setUserStatus(id: string, status: User["status"]): Promise<{ id: string }> {
  if (hasBackendApi()) {
    const path =
      status === "deactivated" ? `/admin/users/${id}/deactivate` : `/admin/users/${id}/reactivate`;
    return apiRequest<AdminUserDto>(path, { method: "POST" }).then(() => ({ id }));
  }
  userStore = userStore.map((u) => (u.id === id ? { ...u, status } : u));
  return simulate({ id });
}

export function getEntraConfig(): Promise<EntraConfig> {
  if (hasBackendApi()) {
    return apiList<AdminDirectorySyncConfigDto>("/admin/directory-sync/config").then((configs) =>
      fromEntraConfig(configs[0]),
    );
  }
  return simulate({ ...entra, mappings: entra.mappings.map((m) => ({ ...m })) });
}

export function updateEntraConfig(input: Omit<EntraConfig, "mappings">): Promise<EntraConfig> {
  if (hasBackendApi()) {
    return Promise.all([
      getFirstOrganization(),
      apiList<AdminDirectorySyncConfigDto>("/admin/directory-sync/config"),
    ]).then(([backendOrg, configs]) => {
      const existing = configs[0];
      if (existing) {
        const body: UpdateDirectorySyncConfigRequest = {
          tenantId: input.tenantId,
          clientId: input.clientId,
          syncMode: input.enabled ? "apply" : "preview",
        };
        return apiRequest<AdminDirectorySyncConfigDto>(
          `/admin/directory-sync/config/${existing.id}`,
          {
            method: "PATCH",
            body,
          },
        ).then(fromEntraConfig);
      }
      if (!backendOrg)
        throw new Error("Organization must be created before configuring directory sync.");
      const body: CreateDirectorySyncConfigRequest = {
        organizationId: backendOrg.id,
        provider: "azure_ad",
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientSecretRef: "AZURE_AD_CLIENT_SECRET",
        syncMode: input.enabled ? "apply" : "preview",
        groupMappings: {},
      };
      return apiRequest<AdminDirectorySyncConfigDto>("/admin/directory-sync/config", {
        method: "POST",
        body,
      }).then(fromEntraConfig);
    });
  }
  entra = { ...entra, ...input };
  return simulate({ ...entra });
}

export function upsertMapping(mapping: EntraConfig["mappings"][number]): Promise<EntraConfig> {
  const exists = entra.mappings.some((m) => m.id === mapping.id);
  entra = {
    ...entra,
    mappings: exists
      ? entra.mappings.map((m) => (m.id === mapping.id ? mapping : m))
      : [...entra.mappings, { ...mapping, id: nextId("map") }],
  };
  return simulate({ ...entra });
}

export function removeMapping(id: string): Promise<EntraConfig> {
  entra = { ...entra, mappings: entra.mappings.filter((m) => m.id !== id) };
  return simulate({ ...entra });
}

export function previewSync(): Promise<SyncPreviewEntry[]> {
  if (hasBackendApi()) {
    return simulate([]);
  }
  return simulate(
    syncPreview.map((e) => ({ ...e })),
    700,
  );
}

export function listSyncHistory(): Promise<SyncRun[]> {
  if (hasBackendApi()) {
    return simulate([]);
  }
  return simulate(history.map((h) => ({ ...h })));
}

export function runSync(): Promise<SyncRun> {
  if (hasBackendApi()) {
    return apiList<AdminDirectorySyncConfigDto>("/admin/directory-sync/config").then((configs) => {
      const config = configs[0];
      if (!config) throw new Error("Configure Microsoft Entra ID sync before running it.");
      return apiRequest<{ runId: string }>(`/admin/directory-sync/config/${config.id}/run`, {
        method: "POST",
      })
        .then((result) =>
          apiRequest<AdminDirectorySyncRunDto>(`/admin/directory-sync/runs/${result.runId}`),
        )
        .then(fromSyncRun);
    });
  }
  const run: SyncRun = {
    id: nextId("sync"),
    startedAt: nowIso(),
    durationMs: 39000,
    triggeredBy: "amara.okafor@northwind.example",
    status: "success",
    added: syncPreview.filter((e) => e.action === "add").length,
    updated: syncPreview.filter((e) => e.action === "update").length,
    deactivated: syncPreview.filter((e) => e.action === "deactivate").length,
  };
  history = [run, ...history];
  return simulate(run, 900);
}
