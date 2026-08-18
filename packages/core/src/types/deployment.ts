export interface Deployment {
  id: string;
  modelName: string;
  provider: string;
  providerModelId: string;
  credentialsRef: string;
  weight: number;
  isActive: boolean;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  retryBackoffMs?: number | null;
}
