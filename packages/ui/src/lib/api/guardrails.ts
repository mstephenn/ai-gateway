import type {
  CreateGuardrailRuleRequest,
  GuardrailRuleDto,
  UpdateGuardrailRuleRequest,
} from "@ai-gateway/shared";
import { apiList, apiRequest, hasBackendApi, nextId, nowIso, simulate } from "./client";
import type { JsonValue } from "@ai-gateway/shared";

export interface GuardrailRule {
  id: string;
  name: string;
  type: GuardrailRuleDto["type"];
  enabled: boolean;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

let store: GuardrailRule[] = [
  {
    id: "gr_01",
    name: "Block internal codenames",
    type: "keyword_block",
    enabled: true,
    config: { keywords: ["project-x", "nexus"], caseSensitive: false },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

const EMPTY_MOCK: GuardrailRule = {
  id: "",
  name: "",
  type: "keyword_block",
  enabled: true,
  config: {},
  createdAt: nowIso(),
  updatedAt: nowIso(),
};

function fromBackend(row: GuardrailRuleDto): GuardrailRule {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listGuardrailRules(): Promise<GuardrailRule[]> {
  if (hasBackendApi()) {
    return apiList<GuardrailRuleDto>("/admin/guardrails").then((rows) => rows.map(fromBackend));
  }
  return simulate(store.map((r) => ({ ...r })));
}

export function createGuardrailRule(input: CreateGuardrailRuleRequest): Promise<GuardrailRule> {
  if (hasBackendApi()) {
    return apiRequest<GuardrailRuleDto>("/admin/guardrails", {
      method: "POST",
      body: input,
    }).then(fromBackend);
  }
  const created: GuardrailRule = {
    id: nextId("gr"),
    name: input.name,
    type: input.type,
    enabled: input.enabled ?? true,
    config: input.config ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store = [created, ...store];
  return simulate(created);
}

export function updateGuardrailRule(
  id: string,
  input: UpdateGuardrailRuleRequest,
): Promise<GuardrailRule> {
  if (hasBackendApi()) {
    return apiRequest<GuardrailRuleDto>(`/admin/guardrails/${id}`, {
      method: "PATCH",
      body: input,
    }).then(fromBackend);
  }
  const existing = store.find((r) => r.id === id);
  const updated: GuardrailRule = {
    ...(existing ?? store[0] ?? EMPTY_MOCK),
    id,
    name: input.name ?? existing?.name ?? "",
    type: existing?.type ?? "keyword_block",
    enabled: input.enabled ?? existing?.enabled ?? true,
    config: input.config ?? existing?.config ?? {},
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  store = store.map((r) => (r.id === id ? updated : r));
  return simulate(updated);
}

export function deleteGuardrailRule(id: string): Promise<{ id: string }> {
  if (hasBackendApi()) {
    return apiRequest<void>(`/admin/guardrails/${id}`, { method: "DELETE" }).then(() => ({ id }));
  }
  store = store.filter((r) => r.id !== id);
  return simulate({ id });
}
