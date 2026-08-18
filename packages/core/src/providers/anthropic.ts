import { UpstreamHttpError } from "../errors.js";
import type { HttpClient } from "../http/httpClient.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
  Tool,
  ToolCall,
  ToolChoice,
} from "../types/chat.js";
import type { Deployment } from "../types/deployment.js";
import type { Provider } from "../types/provider.js";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicToolChoice {
  type: "auto" | "any" | "none" | "tool";
  name?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | { type: string; text: string }[];
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export function toAnthropicTool(tool: Tool): AnthropicTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? {
      type: "object",
      properties: {},
    },
  };
}

export function toAnthropicToolChoice(
  toolChoice: ToolChoice | "none" | "auto" | "required" | undefined,
): AnthropicToolChoice | undefined {
  if (!toolChoice) {
    return undefined;
  }
  if (toolChoice === "auto") {
    return { type: "auto" };
  }
  if (toolChoice === "required") {
    return { type: "any" };
  }
  if (toolChoice === "none") {
    return { type: "none" };
  }
  return { type: "tool", name: toolChoice.function.name };
}

export function toAnthropicMessage(message: ChatMessage): AnthropicMessage {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id ?? "",
          content: message.content ?? "",
        },
      ],
    };
  }

  if (
    message.role === "assistant" &&
    message.tool_calls &&
    message.tool_calls.length > 0
  ) {
    const content: AnthropicContentBlock[] = [];
    if (message.content) {
      content.push({ type: "text", text: message.content });
    }
    for (const toolCall of message.tool_calls) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: parseToolArguments(toolCall.function.arguments),
      });
    }
    return { role: "assistant", content };
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content ?? "",
  };
}

function parseToolArguments(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractSystemAndMessages(messages: ChatMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
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

export function stopReasonToFinishReason(stopReason: string): string {
  if (stopReason === "max_tokens") {
    return "length";
  }
  if (stopReason === "tool_use") {
    return "tool_calls";
  }
  return "stop";
}

export function contentToToolCalls(content: AnthropicContentBlock[]): {
  text: string;
  toolCalls: ToolCall[];
} {
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  const toolCalls: ToolCall[] = content
    .filter((block) => block.type === "tool_use" && block.id && block.name)
    .map((block) => ({
      id: block.id!,
      type: "function",
      function: {
        name: block.name!,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }));
  return { text, toolCalls };
}

interface AnthropicResponse {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export function createAnthropicProvider(
  httpClient: HttpClient,
  apiKey: string,
): Provider {
  return {
    async chatCompletion(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): Promise<ChatCompletionResponse> {
      const { system, messages } = extractSystemAndMessages(req.messages);
      const body: Record<string, unknown> = {
        model: deployment.providerModelId,
        system,
        messages,
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

      const res = await httpClient.fetch(ANTHROPIC_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `Anthropic request failed: ${res.status} ${await res.text()}`,
        );
      }

      const data = (await res.json()) as AnthropicResponse;
      const { text, toolCalls } = contentToToolCalls(data.content);
      const message: ChatMessage = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      return {
        id: data.id,
        object: "chat.completion",
        model: deployment.modelName,
        choices: [
          {
            index: 0,
            message,
            finish_reason: stopReasonToFinishReason(data.stop_reason),
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
      const { system, messages } = extractSystemAndMessages(req.messages);
      const body: Record<string, unknown> = {
        model: deployment.providerModelId,
        system,
        messages,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
        stream: true,
      };
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map(toAnthropicTool);
        const toolChoice = toAnthropicToolChoice(req.tool_choice);
        if (toolChoice) {
          body.tool_choice = toolChoice;
        }
      }

      const res = await httpClient.fetch(ANTHROPIC_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        throw new UpstreamHttpError(
          res.status,
          `Anthropic stream request failed: ${res.status} ${await res.text()}`,
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
          const event = JSON.parse(trimmed.slice("data:".length).trim()) as {
            type: string;
            delta?: { text?: string; stop_reason?: string };
          };
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield {
              id: deployment.id,
              object: "chat.completion.chunk",
              model: deployment.modelName,
              choices: [
                {
                  index: 0,
                  delta: { content: event.delta.text },
                  finish_reason: null,
                },
              ],
            };
          } else if (
            event.type === "message_delta" &&
            event.delta?.stop_reason
          ) {
            yield {
              id: deployment.id,
              object: "chat.completion.chunk",
              model: deployment.modelName,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: stopReasonToFinishReason(
                    event.delta.stop_reason,
                  ),
                },
              ],
            };
          }
        }
      }
    },
  };
}
