export type DeploymentStatus = "active" | "degraded" | "disabled";
export type ProviderName =
  "azure-openai" | "openai" | "anthropic" | "bedrock" | "gemini" | "vertex" | "mistral";

export interface Deployment {
  id: string;
  name: string;
  provider: ProviderName;
  providerModelId: string;
  weight: number;
  status: DeploymentStatus;
  timeoutMs: number;
  retryCount: number;
  credentialsRef: string;
  updatedAt: string;
  health?: "healthy" | "cooldown";
  createdBy?: string;
  createdAt?: string;
  costs?: { input: number; output: number };
  chapterId?: string;
  accessGroup?: string;
  mode?: string;
  providerCredentials?: Record<string, string>;
}

export type TeamStatus = "active" | "suspended";

export interface Team {
  id: string;
  name: string;
  orgUnitId: string;
  members: number;
  budgetTokens: number;
  usedTokens: number;
  rpmLimit: number;
  tpmLimit: number;
  status: TeamStatus;
  createdAt: string;
}

export type ApiKeyStatus = "active" | "revoked" | "expired";
export type KeyOwnerType = "team" | "user";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  ownerType: KeyOwnerType;
  ownerId: string;
  ownerName: string;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  budgetLimit: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  allowedModels: string[];
}

export type UserStatus = "active" | "deactivated" | "invited";
export type UserRole = "owner" | "admin" | "developer" | "viewer";
export type UserSource = "manual" | "entra";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  teamId: string;
  status: UserStatus;
  source: UserSource;
  lastLoginAt: string | null;
}

export interface OrgUnit {
  id: string;
  name: string;
  parentId: string | null;
  type?: string;
  teamId?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  domain: string;
  defaultRegion: string;
  contactEmail: string;
  configured: boolean;
}

export interface GroupMapping {
  id: string;
  groupName: string;
  groupObjectId: string;
  teamId: string;
  role: UserRole;
}

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  enabled: boolean;
  mappings: GroupMapping[];
}

export interface SyncRun {
  id: string;
  startedAt: string;
  durationMs: number;
  triggeredBy: string;
  status: "success" | "partial" | "failed";
  added: number;
  updated: number;
  deactivated: number;
}

export interface SyncPreviewEntry {
  email: string;
  name: string;
  action: "add" | "update" | "deactivate";
  detail: string;
}

export type RequestStatus = "success" | "error" | "rate_limited" | "timeout";

export interface RequestLog {
  id: string;
  createdAt: string;
  model: string;
  teamId: string;
  teamName: string;
  keyId: string;
  keyPrefix: string;
  status: RequestStatus;
  statusCode: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  provider: ProviderName;
  route: string;
}

export interface ProviderHealth {
  provider: ProviderName;
  status: "operational" | "degraded" | "outage";
  successRate: number;
  p95LatencyMs: number;
  deployments: number;
}

export interface OverviewMetrics {
  requestVolume: number;
  requestVolumeDelta: number;
  totalTokens: number;
  totalTokensDelta: number;
  errorRate: number;
  errorRateDelta: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  latencyDelta: number;
  series: { t: string; requests: number; errors: number; p95: number }[];
  topModels: { model: string; requests: number; tokens: number; errorRate: number }[];
  topTeams: { team: string; requests: number; tokens: number; budgetUsed: number }[];
  providerHealth: ProviderHealth[];
}

export interface AnalyticsBucket {
  t: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface AnalyticsBreakdown {
  key: string;
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errors: number;
  p95LatencyMs: number;
}

export interface AnalyticsStatusDistribution {
  status: RequestStatus;
  count: number;
  percentage: number;
}

export interface AnalyticsMetrics {
  start: string;
  end: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  series: AnalyticsBucket[];
  byModel: AnalyticsBreakdown[];
  byTeam: AnalyticsBreakdown[];
  byKey: AnalyticsBreakdown[];
  statusDistribution: AnalyticsStatusDistribution[];
}

export interface BudgetEntry {
  id: string;
  name: string;
  scope: "team" | "key";
  ownerName: string | null;
  budgetTokens: number;
  usedTokens: number;
  remainingTokens: number;
  percentUsed: number;
  status: "healthy" | "warning" | "critical" | "exceeded";
}

export interface BudgetSummary {
  totalBudgeted: number;
  totalUsed: number;
  totalRemaining: number;
  teamCount: number;
  keyCount: number;
  exceededCount: number;
  warningCount: number;
  criticalCount: number;
}
