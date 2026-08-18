import type { AdminTeamDto, CreateTeamRequest, UpdateTeamRequest } from "@ai-gateway/shared";
import { teams as seed } from "../mock-data/fixtures";
import type { Team } from "../mock-data/types";
import { apiList, apiRequest, fail, hasBackendApi, nextId, nowIso, simulate } from "./client";

let store: Team[] = [...seed];

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function fromBackend(row: AdminTeamDto): Team {
  const budget = toNumber(row.budgetLimit);
  return {
    id: row.id,
    name: row.name,
    orgUnitId: "",
    members: 0,
    budgetTokens: budget,
    usedTokens: toNumber(row.spent),
    rpmLimit: 0,
    tpmLimit: 0,
    status: "active",
    createdAt: row.createdAt,
  };
}

function toBackend(input: TeamInput): CreateTeamRequest | UpdateTeamRequest {
  return {
    name: input.name,
    budgetLimit: input.budgetTokens || null,
    allowedModels: [],
  };
}

export function listTeams(): Promise<Team[]> {
  if (hasBackendApi()) {
    return apiList<AdminTeamDto>("/admin/teams").then((rows) => rows.map(fromBackend));
  }
  return simulate(store.map((t) => ({ ...t })));
}

export type TeamInput = Omit<Team, "id" | "createdAt" | "usedTokens">;

export function createTeam(input: TeamInput): Promise<Team> {
  if (hasBackendApi()) {
    return apiRequest<AdminTeamDto>("/admin/teams", {
      method: "POST",
      body: toBackend(input),
    }).then(fromBackend);
  }
  const created: Team = { ...input, id: nextId("team"), usedTokens: 0, createdAt: nowIso() };
  store = [created, ...store];
  return simulate(created);
}

export function updateTeam(id: string, input: TeamInput): Promise<Team> {
  if (hasBackendApi()) {
    return apiRequest<AdminTeamDto>(`/admin/teams/${id}`, {
      method: "PATCH",
      body: toBackend(input),
    }).then(fromBackend);
  }
  const existing = store.find((t) => t.id === id);
  const updated: Team = {
    ...input,
    id,
    usedTokens: existing?.usedTokens ?? 0,
    createdAt: existing?.createdAt ?? nowIso(),
  };
  store = store.map((t) => (t.id === id ? updated : t));
  return simulate(updated);
}

export function deleteTeam(id: string): Promise<{ id: string }> {
  if (hasBackendApi()) {
    return fail("Deleting teams is not supported by the current backend API.");
  }
  store = store.filter((t) => t.id !== id);
  return simulate({ id });
}
