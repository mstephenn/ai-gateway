// packages/plugin-sdk/src/index.ts
// Published separately from gateway core so plugin authors depend on a
// stable, semver'd contract rather than core's internals — core can
// change its own implementation without breaking every plugin on every
// release, as long as this file's exported shapes don't change.
import type { Provider } from "../../core/src/types/provider.js";

export type { Provider } from "../../core/src/types/provider.js";
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
  Tool,
  ToolFunction,
  ToolCall,
  ToolChoice,
} from "../../core/src/types/chat.js";
export type {
  EmbeddingRequest,
  Embedding,
  EmbeddingResponse,
  EmbeddingUsage,
} from "../../core/src/types/embeddings.js";
export type { Deployment } from "../../core/src/types/deployment.js";

export interface ProviderPlugin {
  name: string;
  createProvider(config: unknown): Provider;
}

export interface RequestContext {
  apiKeyId: string;
  model: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface GatewayResponse {
  status: number;
  body: unknown;
}

export interface MiddlewarePlugin {
  name: string;
  onRequest?(ctx: RequestContext): Promise<void | GatewayResponse>;
  onResponse?(
    ctx: RequestContext,
    response: GatewayResponse,
  ): Promise<GatewayResponse>;
}

export interface RoutingContext {
  model: string;
}

export interface RoutingStrategyPlugin {
  name: string;
  selectDeployment<D extends { id: string; weight: number }>(
    eligible: D[],
    context: RoutingContext,
  ): D;
}
