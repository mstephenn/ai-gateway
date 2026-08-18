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

export interface AzureOpenAIConfig {
  apiKey: string;
  resourceName: string;
  apiVersion: string;
}

function buildChatUrl(
  config: AzureOpenAIConfig,
  deployment: Deployment,
): string {
  return `https://${config.resourceName}.openai.azure.com/openai/deployments/${deployment.providerModelId}/chat/completions?api-version=${config.apiVersion}`;
}

function buildEmbeddingsUrl(
  config: AzureOpenAIConfig,
  deployment: Deployment,
): string {
  return `https://${config.resourceName}.openai.azure.com/openai/deployments/${deployment.providerModelId}/embeddings?api-version=${config.apiVersion}`;
}

export function createAzureOpenAIProvider(
  httpClient: HttpClient,
  config: AzureOpenAIConfig,
): Provider {
  return {
    async chatCompletion(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): Promise<ChatCompletionResponse> {
      const res = await httpClient.fetch(buildChatUrl(config, deployment), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify({
          messages: req.messages,
          temperature: req.temperature,
          max_tokens: req.max_tokens,
          tools: req.tools,
          tool_choice: req.tool_choice,
        }),
      });

      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `Azure OpenAI request failed: ${res.status} ${await res.text()}`,
        );
      }

      return (await res.json()) as ChatCompletionResponse;
    },

    async embeddings(
      req: EmbeddingRequest,
      deployment: Deployment,
    ): Promise<EmbeddingResponse> {
      const res = await httpClient.fetch(
        buildEmbeddingsUrl(config, deployment),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": config.apiKey,
          },
          body: JSON.stringify({
            input: req.input,
            encoding_format: req.encoding_format,
            dimensions: req.dimensions,
            user: req.user,
          }),
        },
      );

      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `Azure OpenAI embeddings request failed: ${res.status} ${await res.text()}`,
        );
      }

      return (await res.json()) as EmbeddingResponse;
    },

    async *chatCompletionStream(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): AsyncIterable<ChatCompletionChunk> {
      const res = await httpClient.fetch(buildChatUrl(config, deployment), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify({
          messages: req.messages,
          temperature: req.temperature,
          max_tokens: req.max_tokens,
          tools: req.tools,
          tool_choice: req.tool_choice,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        throw new UpstreamHttpError(
          res.status,
          `Azure OpenAI stream request failed: ${res.status} ${await res.text()}`,
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
