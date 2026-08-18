import { UpstreamHttpError } from "../errors.js";
import type { HttpClient } from "../http/httpClient.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../types/chat.js";
import type { Deployment } from "../types/deployment.js";
import type {
  EmbeddingRequest,
  EmbeddingResponse,
} from "../types/embeddings.js";
import type { Provider } from "../types/provider.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export function createOpenAIProvider(
  httpClient: HttpClient,
  apiKey: string,
): Provider {
  return {
    async chatCompletion(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): Promise<ChatCompletionResponse> {
      const res = await httpClient.fetch(OPENAI_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          ...req,
          model: deployment.providerModelId,
          stream: false,
        }),
      });

      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `OpenAI request failed: ${res.status} ${await res.text()}`,
        );
      }

      return (await res.json()) as ChatCompletionResponse;
    },

    async embeddings(
      req: EmbeddingRequest,
      deployment: Deployment,
    ): Promise<EmbeddingResponse> {
      const res = await httpClient.fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: req.input,
          model: deployment.providerModelId,
          encoding_format: req.encoding_format,
          dimensions: req.dimensions,
          user: req.user,
        }),
      });

      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `OpenAI embeddings request failed: ${res.status} ${await res.text()}`,
        );
      }

      return (await res.json()) as EmbeddingResponse;
    },

    async *chatCompletionStream(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): AsyncIterable<ChatCompletionChunk> {
      const res = await httpClient.fetch(OPENAI_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          ...req,
          model: deployment.providerModelId,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        throw new UpstreamHttpError(
          res.status,
          `OpenAI stream request failed: ${res.status} ${await res.text()}`,
        );
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const data = trimmed.slice("data:".length).trim();
          if (data === "[DONE]") {
            return;
          }
          yield JSON.parse(data) as ChatCompletionChunk;
        }
      }
    },
  };
}
