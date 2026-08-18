import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "./chat.js";
import type { Deployment } from "./deployment.js";
import type { EmbeddingRequest, EmbeddingResponse } from "./embeddings.js";

export interface Provider {
  chatCompletion(
    req: ChatCompletionRequest,
    deployment: Deployment,
  ): Promise<ChatCompletionResponse>;
  chatCompletionStream(
    req: ChatCompletionRequest,
    deployment: Deployment,
  ): AsyncIterable<ChatCompletionChunk>;
  embeddings?(
    req: EmbeddingRequest,
    deployment: Deployment,
  ): Promise<EmbeddingResponse>;
}
