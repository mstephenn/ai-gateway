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

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

function roleToGemini(
  role: ChatMessage["role"],
): GeminiContent["role"] | undefined {
  if (role === "user" || role === "tool" || role === "system") {
    return "user";
  }
  if (role === "assistant") {
    return "model";
  }
  return undefined;
}

function toGeminiTool(tool: Tool): GeminiTool {
  return {
    functionDeclarations: [
      {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    ],
  };
}

function toGeminiToolChoice(
  toolChoice: ToolChoice | "none" | "auto" | "required" | undefined,
): Record<string, unknown> | undefined {
  if (!toolChoice || toolChoice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }
  return {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [toolChoice.function.name],
    },
  };
}

function parseToolArguments(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toGeminiPart(message: ChatMessage): GeminiPart {
  if (message.role === "tool") {
    return {
      functionResponse: {
        name: message.tool_call_id ?? "",
        response:
          typeof message.content === "string"
            ? { result: message.content }
            : (message.content ?? {}),
      },
    };
  }

  if (
    message.role === "assistant" &&
    message.tool_calls &&
    message.tool_calls.length > 0
  ) {
    // Gemini only supports one function call per part, so use the first one.
    const toolCall = message.tool_calls[0]!;
    return {
      functionCall: {
        name: toolCall.function.name,
        args: parseToolArguments(toolCall.function.arguments),
      },
    };
  }

  return {
    text:
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
  };
}

function buildContents(messages: ChatMessage[]): {
  systemInstruction?: GeminiContent;
  contents: GeminiContent[];
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  const systemInstruction: GeminiContent | undefined =
    systemMessages.length > 0
      ? {
          role: "user",
          parts: [
            {
              text: systemMessages
                .map((m) =>
                  typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content),
                )
                .join("\n"),
            },
          ],
        }
      : undefined;

  const contents: GeminiContent[] = [];
  for (const message of otherMessages) {
    const role = roleToGemini(message.role);
    if (!role) {
      continue;
    }
    contents.push({ role, parts: [toGeminiPart(message)] });
  }

  return { systemInstruction, contents };
}

function buildRequestBody(req: ChatCompletionRequest): Record<string, unknown> {
  const { systemInstruction, contents } = buildContents(req.messages);
  const generationConfig: Record<string, unknown> = {};
  if (req.max_tokens !== undefined) {
    generationConfig.maxOutputTokens = req.max_tokens;
  }
  if (req.temperature !== undefined) {
    generationConfig.temperature = req.temperature;
  }

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map(toGeminiTool);
    const toolConfig = toGeminiToolChoice(req.tool_choice);
    if (toolConfig) {
      body.toolConfig = toolConfig;
    }
  }
  return body;
}

function finishReasonToOpenAI(finishReason: string | undefined): string {
  if (finishReason === "MAX_TOKENS") {
    return "length";
  }
  if (finishReason === "STOP") {
    return "stop";
  }
  // Gemini emits OTHER or no finish reason for function calls in some cases.
  return "stop";
}

function candidateToToolCalls(candidate?: GeminiCandidate): {
  text: string;
  toolCalls: ToolCall[];
} {
  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];
  let index = 0;
  for (const part of candidate?.content?.parts ?? []) {
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${index}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      });
      index++;
    } else if (part.text) {
      textParts.push(part.text);
    }
  }
  return { text: textParts.join(""), toolCalls };
}

function buildUrl(modelId: string, apiKey: string, stream: boolean): string {
  const action = stream ? "streamGenerateContent" : "generateContent";
  return `${GEMINI_BASE_URL}/${modelId}:${action}?key=${apiKey}`;
}

export function createGeminiProvider(
  httpClient: HttpClient,
  apiKey: string,
): Provider {
  return {
    async chatCompletion(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): Promise<ChatCompletionResponse> {
      const body = buildRequestBody(req);

      const res = await httpClient.fetch(
        buildUrl(deployment.providerModelId, apiKey, false),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        throw new UpstreamHttpError(
          res.status,
          `Gemini request failed: ${res.status} ${await res.text()}`,
        );
      }

      const data = (await res.json()) as GeminiResponse;
      const candidate = data.candidates?.[0];
      const { text, toolCalls } = candidateToToolCalls(candidate);
      const usage = data.usageMetadata ?? {};
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
            finish_reason:
              toolCalls.length > 0
                ? "tool_calls"
                : finishReasonToOpenAI(candidate?.finishReason),
          },
        ],
        usage: {
          prompt_tokens: usage.promptTokenCount ?? 0,
          completion_tokens: usage.candidatesTokenCount ?? 0,
          total_tokens: usage.totalTokenCount ?? 0,
        },
      };
    },

    async *chatCompletionStream(
      req: ChatCompletionRequest,
      deployment: Deployment,
    ): AsyncIterable<ChatCompletionChunk> {
      const body = buildRequestBody(req);

      const res = await httpClient.fetch(
        buildUrl(deployment.providerModelId, apiKey, true),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok || !res.body) {
        throw new UpstreamHttpError(
          res.status,
          `Gemini stream request failed: ${res.status} ${await res.text()}`,
        );
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Flush any remaining line that wasn't terminated by a newline.
          if (buffer.trim()) {
            yield* emitGeminiChunk(buffer, deployment);
          }
          break;
        }
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          yield* emitGeminiChunk(line, deployment);
        }
      }
    },
  };
}

function* emitGeminiChunk(
  line: string,
  deployment: Deployment,
): Generator<ChatCompletionChunk> {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  try {
    const data = JSON.parse(trimmed) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const { text, toolCalls } = candidateToToolCalls(candidate);
    if (!text && toolCalls.length === 0 && !candidate?.finishReason) {
      return;
    }
    yield {
      id: deployment.id,
      object: "chat.completion.chunk",
      model: deployment.modelName,
      choices: [
        {
          index: 0,
          delta: {
            content: text || undefined,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: candidate?.finishReason
            ? finishReasonToOpenAI(candidate.finishReason)
            : null,
        },
      ],
    };
  } catch {
    // Ignore malformed JSON lines in the stream.
  }
}
