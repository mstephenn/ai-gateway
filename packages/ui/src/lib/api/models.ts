import type {
  AdminDeploymentDto,
  CreateDeploymentRequest,
  UpdateDeploymentRequest,
} from "@ai-gateway/shared";
import { deployments as seed } from "../mock-data/fixtures";
import type { Deployment } from "../mock-data/types";
import { apiList, apiRequest, hasBackendApi, nextId, nowIso, simulate } from "./client";

let store: Deployment[] = [...seed];

type BackendDeploymentRow = AdminDeploymentDto & {
  health?: "healthy" | "cooldown";
  createdBy?: string;
  createdAt?: string;
  costs?: { input: number; output: number };
  chapterId?: string;
  accessGroup?: string;
  mode?: string;
  providerCredentials?: Record<string, string>;
};

function fromBackend(row: BackendDeploymentRow): Deployment {
  return {
    id: row.id,
    name: row.modelName,
    provider: row.provider as Deployment["provider"],
    providerModelId: row.providerModelId,
    weight: row.weight,
    status: row.isActive ? "active" : "disabled",
    timeoutMs: row.timeoutMs ?? 30000,
    retryCount: row.maxRetries ?? 0,
    credentialsRef: row.credentialsRef,
    updatedAt: nowIso(),
    ...(row.health !== undefined ? { health: row.health } : {}),
    ...(row.createdBy !== undefined ? { createdBy: row.createdBy } : {}),
    ...(row.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
    ...(row.costs !== undefined ? { costs: row.costs } : {}),
    ...(row.chapterId !== undefined ? { chapterId: row.chapterId } : {}),
    ...(row.accessGroup !== undefined ? { accessGroup: row.accessGroup } : {}),
    ...(row.mode !== undefined ? { mode: row.mode } : {}),
    ...(row.providerCredentials !== undefined ? { providerCredentials: row.providerCredentials } : {}),
  };
}

function toBackend(input: DeploymentInput): CreateDeploymentRequest | UpdateDeploymentRequest {
  return {
    modelName: input.name,
    provider: input.provider,
    providerModelId: input.providerModelId,
    credentialsRef: input.credentialsRef,
    weight: input.weight,
    isActive: input.status !== "disabled",
    timeoutMs: input.timeoutMs,
    maxRetries: input.retryCount,
  };
}

export function listDeployments(): Promise<Deployment[]> {
  if (hasBackendApi()) {
    return apiList<BackendDeploymentRow>("/admin/deployments").then((rows) => rows.map(fromBackend));
  }
  return simulate(store.map((d) => ({ ...d })));
}

export type DeploymentInput = Omit<Deployment, "id" | "updatedAt">;

export function createDeployment(input: DeploymentInput): Promise<Deployment> {
  if (hasBackendApi()) {
    return apiRequest<BackendDeploymentRow>("/admin/deployments", {
      method: "POST",
      body: toBackend(input),
    }).then(fromBackend);
  }
  const created: Deployment = { ...input, id: nextId("dep"), updatedAt: nowIso() };
  store = [created, ...store];
  return simulate(created);
}

export function updateDeployment(id: string, input: DeploymentInput): Promise<Deployment> {
  if (hasBackendApi()) {
    return apiRequest<BackendDeploymentRow>(`/admin/deployments/${id}`, {
      method: "PATCH",
      body: toBackend(input),
    }).then(fromBackend);
  }
  const updated: Deployment = { ...input, id, updatedAt: nowIso() };
  store = store.map((d) => (d.id === id ? updated : d));
  return simulate(updated);
}

export function deleteDeployment(id: string): Promise<{ id: string }> {
  if (hasBackendApi()) {
    return apiRequest<void>(`/admin/deployments/${id}`, { method: "DELETE" }).then(() => ({ id }));
  }
  store = store.filter((d) => d.id !== id);
  return simulate({ id });
}
