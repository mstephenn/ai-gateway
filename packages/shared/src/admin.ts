export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ListResponse<T> {
  object: "list";
  data: T[];
}

export type DecimalJson = string | number;
export type DateJson = string;

export type ProviderName =
  | "azure-openai"
  | "openai"
  | "anthropic"
  | "bedrock"
  | "gemini"
  | "vertex"
  | "mistral";

export type ProviderCredentialProvider =
  "openai" | "anthropic" | "bedrock" | "azure-openai" | "gemini";

export interface AdminProviderCredentialDto {
  id: string;
  provider: ProviderCredentialProvider;
  name: string;
  createdAt: DateJson;
  updatedAt: DateJson;
}

export interface CreateProviderCredentialRequest {
  provider: ProviderCredentialProvider;
  name: string;
  config: Record<string, string>;
}

export interface UpdateProviderCredentialRequest {
  name?: string;
  config?: Record<string, string>;
}

export interface AdminDeploymentDto {
  id: string;
  modelName: string;
  provider: ProviderName | string;
  providerModelId: string;
  credentialsRef: string;
  weight: number;
  isActive: boolean;
  timeoutMs: number | null;
  maxRetries: number | null;
  retryBackoffMs: number | null;
}

export interface CreateDeploymentRequest {
  modelName: string;
  provider: string;
  providerModelId: string;
  credentialsRef: string;
  weight?: number;
  isActive?: boolean;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  retryBackoffMs?: number | null;
}

export type UpdateDeploymentRequest = Partial<CreateDeploymentRequest>;

export interface AdminTeamDto {
  id: string;
  name: string;
  budgetLimit: DecimalJson | null;
  spent: DecimalJson;
  allowedModels: string[];
  createdAt: DateJson;
}

export interface CreateTeamRequest {
  name: string;
  budgetLimit?: number | null;
  allowedModels?: string[];
}

export interface UpdateTeamRequest {
  name?: string;
  budgetLimit?: number | null;
  allowedModels?: string[];
}

export interface AdminApiKeyDto {
  id: string;
  name: string | null;
  teamId: string | null;
  teamName: string | null;
  key?: string;
  keyPrefix: string;
  isActive: boolean;
  expiresAt: DateJson | null;
  budgetLimit: DecimalJson | null;
  spent?: DecimalJson;
  rpmLimit: number | null;
  tpmLimit: number | null;
  allowedModels: string[];
  createdAt: DateJson;
  lastUsedAt?: DateJson | null;
}

export interface CreateApiKeyRequest {
  name?: string;
  teamId?: string;
  expiresAt?: DateJson | null;
  budgetLimit?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  allowedModels?: string[];
}

export interface UpdateApiKeyRequest {
  name?: string;
  teamId?: string | null;
  expiresAt?: DateJson | null;
  budgetLimit?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  allowedModels?: string[];
}

export interface AdminOrganizationDto {
  id: string;
  name: string;
  domain: string | null;
  createdAt: DateJson;
  updatedAt: DateJson;
}

export interface CreateOrganizationRequest {
  name: string;
  domain?: string | null;
}

export type UpdateOrganizationRequest = Partial<CreateOrganizationRequest>;

export type OrgUnitType =
  "root" | "business_unit" | "department" | "cost_center" | "project" | "team";

export interface AdminOrgUnitDto {
  id: string;
  organizationId: string;
  type: OrgUnitType;
  name: string;
  parentId: string | null;
  teamId: string | null;
  externalId: string | null;
  createdAt: DateJson;
  updatedAt: DateJson;
  children?: AdminOrgUnitDto[];
}

export interface OrgUnitsResponse extends ListResponse<AdminOrgUnitDto> {
  format: "flat" | "tree";
}

export interface CreateOrgUnitRequest {
  organizationId: string;
  type: OrgUnitType;
  name: string;
  parentId?: string | null;
  teamId?: string | null;
}

export interface UpdateOrgUnitRequest {
  name?: string;
  parentId?: string | null;
  teamId?: string | null;
}

export type AdminUserStatus = "active" | "inactive";
export type AdminUserSource = "manual" | "directory" | "linked";

export interface AdminUserDto {
  id: string;
  organizationId: string | null;
  email: string;
  name: string | null;
  status: AdminUserStatus;
  source: AdminUserSource;
  externalId: string | null;
  createdAt: DateJson;
  updatedAt: DateJson;
}

export interface CreateUserRequest {
  email: string;
  name?: string | null;
  organizationId?: string | null;
  source?: AdminUserSource;
  externalId?: string | null;
}

export interface UpdateUserRequest {
  name?: string | null;
  email?: string;
  status?: AdminUserStatus;
  source?: AdminUserSource;
  externalId?: string | null;
}

export interface AdminRoleDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: DateJson;
  updatedAt: DateJson;
}

export interface AdminMembershipDto {
  id: string;
  userId: string;
  orgUnitId: string;
  roleId: string;
  createdAt: DateJson;
  updatedAt: DateJson;
  user?: AdminUserDto;
  orgUnit?: AdminOrgUnitDto;
  role?: AdminRoleDto;
}

export interface CreateMembershipRequest {
  userId: string;
  orgUnitId: string;
  roleId: string;
}

export type DirectorySyncProvider = "azure_ad";
export type DirectorySyncMode = "preview" | "apply";
export type DirectorySyncRunStatus =
  "pending" | "running" | "completed" | "failed";
export type DirectorySyncChangeAction =
  | "create_user"
  | "update_user"
  | "disable_user"
  | "add_membership"
  | "remove_membership";
export type DirectorySyncChangeStatus =
  "pending" | "applied" | "skipped" | "failed";

export interface DirectoryGroupMapping {
  orgUnitId: string;
  roleId: string;
}

export interface AdminDirectorySyncConfigDto {
  id: string;
  organizationId: string;
  provider: DirectorySyncProvider;
  tenantId: string;
  clientId: string;
  clientSecretRef: string;
  syncMode: DirectorySyncMode;
  groupMappings: Record<string, DirectoryGroupMapping>;
  createdAt: DateJson;
  updatedAt: DateJson;
  organization?: AdminOrganizationDto;
}

export interface CreateDirectorySyncConfigRequest {
  organizationId: string;
  provider: DirectorySyncProvider;
  tenantId: string;
  clientId: string;
  clientSecretRef: string;
  syncMode: DirectorySyncMode;
  groupMappings?: Record<string, DirectoryGroupMapping>;
}

export type UpdateDirectorySyncConfigRequest = Partial<
  Omit<CreateDirectorySyncConfigRequest, "organizationId" | "provider">
>;

export interface RunDirectorySyncResponse {
  runId: string;
  status: DirectorySyncRunStatus;
  changesCount: number;
  error: string | null;
}

export interface AdminDirectorySyncRunDto {
  id: string;
  configId: string;
  status: DirectorySyncRunStatus;
  startedAt: DateJson | null;
  completedAt: DateJson | null;
  summary: JsonValue;
  createdAt: DateJson;
}

export interface AdminDirectorySyncChangeDto {
  id: string;
  runId: string;
  action: DirectorySyncChangeAction;
  userEmail: string;
  oldValues: JsonValue;
  newValues: JsonValue;
  status: DirectorySyncChangeStatus;
  error: string | null;
  createdAt: DateJson;
}

export type GuardrailRuleType = "keyword_block" | "pii_mask" | "moderation";

export interface GuardrailRuleDto {
  id: string;
  name: string;
  type: GuardrailRuleType;
  enabled: boolean;
  config: JsonValue;
  createdAt: DateJson;
  updatedAt: DateJson;
}

export interface CreateGuardrailRuleRequest {
  name: string;
  type: GuardrailRuleType;
  enabled?: boolean;
  config?: JsonValue;
}

export interface UpdateGuardrailRuleRequest {
  name?: string;
  enabled?: boolean;
  config?: JsonValue;
}

export type UsageGroupBy = "key" | "team" | "model";
export type UsageBucket = "hour" | "day";

export interface UsageAggregateDto {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface UsageGroupDto extends UsageAggregateDto {
  groupValue: string;
  label: string;
}

export interface UsageResponse extends ListResponse<UsageGroupDto> {
  groupBy: UsageGroupBy;
  start: DateJson;
  end: DateJson;
}

export interface UsageKeyBucketDto extends UsageAggregateDto {
  bucketStart: DateJson;
}

export interface UsageKeyResponse extends ListResponse<UsageKeyBucketDto> {
  apiKeyId: string;
  bucket: UsageBucket;
  start: DateJson;
  end: DateJson;
}

export interface AdminOverviewTopEntryDto {
  key: string;
  label: string;
  requestCount: number;
}

export interface AdminOverviewBudgetPressureDto {
  scope: "key" | "team";
  id: string;
  label: string;
  spent: DecimalJson;
  budgetLimit: DecimalJson;
}

export interface AdminOverviewDto {
  start: DateJson;
  end: DateJson;
  requestCount: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  topModels: AdminOverviewTopEntryDto[];
  topTeams: AdminOverviewTopEntryDto[];
  unhealthyDeploymentIds: string[];
  budgetPressure: AdminOverviewBudgetPressureDto[];
  rateLimitPressure: null;
  rateLimitPressureNote: string;
}
