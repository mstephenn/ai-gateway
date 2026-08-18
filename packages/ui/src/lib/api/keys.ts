import type { AdminApiKeyDto, CreateApiKeyRequest, UpdateApiKeyRequest } from "@ai-gateway/shared";
import { apiKeys as seed } from "../mock-data/fixtures";
import type { ApiKey, KeyOwnerType } from "../mock-data/types";
import { apiList, apiRequest, hasBackendApi, nextId, nowIso, simulate } from "./client";

let store: ApiKey[] = [...seed];

function statusFor(row: AdminApiKeyDto): ApiKey["status"] {
  if (!row.isActive) return "revoked";
  if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) return "expired";
  return "active";
}

function fromBackend(row: AdminApiKeyDto): ApiKey {
  return {
    id: row.id,
    name: row.name ?? row.keyPrefix,
    prefix: row.keyPrefix,
    ownerType: "team",
    ownerId: row.teamId ?? "",
    ownerName: row.teamName ?? "No team",
    status: statusFor(row),
    lastUsedAt: row.lastUsedAt ?? null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    budgetLimit: toNumberOrNull(row.budgetLimit),
    rpmLimit: row.rpmLimit,
    tpmLimit: row.tpmLimit,
    allowedModels: row.allowedModels,
  };
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return null;
}

export function listApiKeys(): Promise<ApiKey[]> {
  if (hasBackendApi()) {
    return apiList<AdminApiKeyDto>("/admin/keys").then((rows) => rows.map(fromBackend));
  }
  return simulate(store.map((k) => ({ ...k })));
}

export interface CreateKeyInput {
  name: string;
  ownerType: KeyOwnerType;
  ownerId: string;
  ownerName: string;
  expiresAt: string | null;
  budgetLimit: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  allowedModels: string[];
}

export interface KeySecretResult {
  key: ApiKey;
  /** Full secret — returned once by the gateway and never retrievable again. */
  secret: string;
}

function mintSecret(prefix: string): string {
  const body = Array.from({ length: 32 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36)),
  ).join("");
  return `${prefix}_${body}`;
}

export function createApiKey(input: CreateKeyInput): Promise<KeySecretResult> {
  if (hasBackendApi()) {
    const body: CreateApiKeyRequest = {
      name: input.name,
      expiresAt: input.expiresAt,
      budgetLimit: input.budgetLimit,
      rpmLimit: input.rpmLimit,
      tpmLimit: input.tpmLimit,
      allowedModels: input.allowedModels,
    };
    if (input.ownerType === "team") {
      body.teamId = input.ownerId;
    }
    return apiRequest<AdminApiKeyDto>("/admin/keys", {
      method: "POST",
      body,
    }).then((row) => ({ key: fromBackend(row), secret: row.key ?? "" }));
  }
  const prefix = `gw_live_${Math.random().toString(16).slice(2, 6)}`;
  const key: ApiKey = {
    id: nextId("key"),
    name: input.name,
    prefix,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    status: "active",
    lastUsedAt: null,
    expiresAt: input.expiresAt,
    createdAt: nowIso(),
    budgetLimit: input.budgetLimit,
    rpmLimit: input.rpmLimit,
    tpmLimit: input.tpmLimit,
    allowedModels: input.allowedModels,
  };
  store = [key, ...store];
  return simulate({ key, secret: mintSecret(prefix) });
}

export function rotateApiKey(id: string): Promise<KeySecretResult> {
  if (hasBackendApi()) {
    return apiRequest<AdminApiKeyDto>(`/admin/keys/${id}/rotate`, { method: "POST" }).then(
      (row) => ({
        key: fromBackend(row),
        secret: row.key ?? "",
      }),
    );
  }
  const existing = store.find((k) => k.id === id);
  if (!existing) throw new Error("Key not found");
  const prefix = `gw_live_${Math.random().toString(16).slice(2, 6)}`;
  const rotated: ApiKey = {
    ...existing,
    prefix,
    status: "active",
    createdAt: nowIso(),
    lastUsedAt: null,
  };
  store = store.map((k) => (k.id === id ? rotated : k));
  return simulate({ key: rotated, secret: mintSecret(prefix) });
}

export interface UpdateKeyInput {
  name: string;
  ownerType: KeyOwnerType;
  ownerId: string;
  ownerName: string;
  expiresAt: string | null;
  budgetLimit: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  allowedModels: string[];
}

export function updateApiKey(id: string, input: UpdateKeyInput): Promise<ApiKey> {
  if (hasBackendApi()) {
    const body: UpdateApiKeyRequest = {
      name: input.name,
      teamId: input.ownerType === "team" ? input.ownerId : null,
      expiresAt: input.expiresAt,
      budgetLimit: input.budgetLimit,
      rpmLimit: input.rpmLimit,
      tpmLimit: input.tpmLimit,
      allowedModels: input.allowedModels,
    };
    return apiRequest<AdminApiKeyDto>(`/admin/keys/${id}`, { method: "PATCH", body }).then(
      fromBackend,
    );
  }
  const updated: ApiKey = {
    ...input,
    id,
    prefix: store.find((k) => k.id === id)?.prefix ?? "",
    status: store.find((k) => k.id === id)?.status ?? "active",
    lastUsedAt: store.find((k) => k.id === id)?.lastUsedAt ?? null,
    createdAt: store.find((k) => k.id === id)?.createdAt ?? nowIso(),
  };
  store = store.map((k) => (k.id === id ? updated : k));
  return simulate(updated);
}

export function revokeApiKey(id: string): Promise<{ id: string }> {
  if (hasBackendApi()) {
    return apiRequest<void>(`/admin/keys/${id}`, { method: "DELETE" }).then(() => ({ id }));
  }
  store = store.map((k) => (k.id === id ? { ...k, status: "revoked" as const } : k));
  return simulate({ id });
}
