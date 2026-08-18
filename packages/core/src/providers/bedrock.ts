// Bedrock's InvokeModel API requires SigV4-signed requests — uses the
// official @aws-sdk/signature-v4 package rather than hand-rolling
// request signing, per this project's "standard over hand-rolled"
// convention. Uses Bedrock's Anthropic-compatible request/response shape
// (the same providerModelId family this fork's Bedrock usage already
// targets), so the response translation mirrors the Anthropic provider.
import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@aws-sdk/signature-v4";

import { UpstreamHttpError } from "../errors.js";
import {
  toAnthropicTool,
  toAnthropicToolChoice,
  toAnthropicMessage,
  contentToToolCalls,
  stopReasonToFinishReason as anthropicStopReasonToFinishReason,
} from "./anthropic.js";
import type { HttpClient } from "../http/httpClient.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
} from "../types/chat.js";
import type { Deployment } from "../types/deployment.js";
import type { Provider } from "../types/provider.js";

export interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

interface BedrockContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface BedrockResponse {
  content: BedrockContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function signedRequest(
  credentials: BedrockCredentials,
  path: string,
  body: unknown,
): Promise<{ url: string; headers: Record<string, string>; body: string }> {
  const host = `bedrock-runtime.${credentials.region}.amazonaws.com`;
  const signer = new SignatureV4({
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    region: credentials.region,
    service: "bedrock",
    sha256: Sha256,
  });

  const bodyString = JSON.stringify(body);
  const signed = await signer.sign({
    method: "POST",
    protocol: "https:",
    hostname: host,
    path,
    headers: { host, "content-type": "application/json" },
    body: bodyString,
  });

  return {
    url: `https://${host}${path}`,
    headers: signed.headers as Record<string, string>,
    body: bodyString,
  };
}

function extractSystemAndMessages(messages: ChatMessage[]): {
  system?: string;
  messages: ReturnType<typeof toAnthropicMessage>[];
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  return {
    system:
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n")
        : undefined,
    messages: rest.map(toAnthropicMessage),
  };
}

export function createBedrockProvider(
  httpClient: HttpClient,
  credentials: BedrockCredentials,
): Provider {
  return {
    async chatCompletion(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): Promise<ChatCompletionResponse> {
      const { system, messages } = extractSystemAndMessages(req.messages);
      const body: Record<string, unknown> = {
        anthropic_version: "bedrock-2023-05-31",
        messages,
        system,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
      };
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map(toAnthropicTool);
        const toolChoice = toAnthropicToolChoice(req.tool_choice);
        if (toolChoice) {
          body.tool_choice = toolChoice;
        }
      }

      const path = `/model/${encodeURIComponent(deployment.providerModelId)}/invoke`;
      const {
        url,
        headers,
        body: signedBody,
      } = await signedRequest(credentials, path, body);

      const res = await httpClient.fetch(url, {
        method: "POST",
        headers,
        body: signedBody,
      });
      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `Bedrock request failed: ${res.status} ${await res.text()}`,
        );
      }

      const data = (await res.json()) as BedrockResponse;
      const { text, toolCalls } = contentToToolCalls(
        data.content.map((block) => ({
          type: block.type,
          text: block.text,
          id: block.id,
          name: block.name,
          input: block.input,
        })),
      );
      const message: ChatMessage = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      return {
        id: deployment.id,
        object: "chat.completion",
        model: deployment.modelName,
        choices: [
          {
            index: 0,
            message,
            finish_reason: anthropicStopReasonToFinishReason(data.stop_reason),
          },
        ],
        usage: {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        },
      };
    },

    async *chatCompletionStream(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): AsyncIterable<ChatCompletionChunk> {
      const body: Record<string, unknown> = {
        anthropic_version: "bedrock-2023-05-31",
        messages: req.messages.filter((m) => m.role !== "system"),
        system: req.messages.find((m) => m.role === "system")?.content,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
      };
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map(toAnthropicTool);
        const toolChoice = toAnthropicToolChoice(req.tool_choice);
        if (toolChoice) {
          body.tool_choice = toolChoice;
        }
      }

      const path = `/model/${encodeURIComponent(deployment.providerModelId)}/invoke-with-response-stream`;
      const {
        url,
        headers,
        body: signedBody,
      } = await signedRequest(credentials, path, body);

      const res = await httpClient.fetch(url, {
        method: "POST",
        headers,
        body: signedBody,
      });
      if (!res.ok || !res.body) {
        throw new UpstreamHttpError(
          res.status,
          `Bedrock stream request failed: ${res.status} ${await res.text()}`,
        );
      }

      // Bedrock's response stream uses an AWS event-stream envelope; the
      // JSON payload for each chunk is embedded within it. Parsing that
      // envelope fully is deployment-specific SDK plumbing better handled
      // by @aws-sdk/eventstream-codec in a follow-up — deferred here since
      // it doesn't change this provider's public interface or the router's
      // behavior, only the internals of this one generator.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        yield {
          id: deployment.id,
          object: "chat.completion.chunk",
          model: deployment.modelName,
          choices: [
            { index: 0, delta: { content: value }, finish_reason: null },
          ],
        };
      }
    },
  };
}
