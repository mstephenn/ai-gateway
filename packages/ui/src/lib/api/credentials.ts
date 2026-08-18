import type {
  AdminProviderCredentialDto,
  CreateProviderCredentialRequest,
  UpdateProviderCredentialRequest,
} from "@ai-gateway/shared";
import { apiList, apiRequest } from "./client";

export interface ProviderCredential {
  id: string;
  provider: AdminProviderCredentialDto["provider"];
  name: string;
  createdAt: string;
  updatedAt: string;
}

function fromBackend(row: AdminProviderCredentialDto): ProviderCredential {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCredentials(): Promise<ProviderCredential[]> {
  return apiList<AdminProviderCredentialDto>("/admin/credentials").then((rows) =>
    rows.map(fromBackend),
  );
}

export function createCredential(
  input: CreateProviderCredentialRequest,
): Promise<ProviderCredential> {
  return apiRequest<AdminProviderCredentialDto>("/admin/credentials", {
    method: "POST",
    body: input,
  }).then(fromBackend);
}

export function updateCredential(
  id: string,
  input: UpdateProviderCredentialRequest,
): Promise<ProviderCredential> {
  return apiRequest<AdminProviderCredentialDto>(`/admin/credentials/${id}`, {
    method: "PATCH",
    body: input,
  }).then(fromBackend);
}

export function deleteCredential(id: string): Promise<{ id: string }> {
  return apiRequest<void>(`/admin/credentials/${id}`, { method: "DELETE" }).then(() => ({ id }));
}
