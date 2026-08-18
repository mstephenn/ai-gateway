import type { RequestContext } from "@ai-gateway/plugin-sdk";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../auth/authenticate.js";
import type { BudgetChecker } from "../budget/budget.js";
import type { DbClient } from "../db/client.js";
import {
  statusForError,
  UnauthorizedError,
  ModelAccessDeniedError,
} from "../errors.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { RateLimiter } from "../rateLimiter/rateLimiter.js";
import type { Router } from "../router/router.js";
import type { EmbeddingRequest } from "../types/embeddings.js";

export interface EmbeddingsRouteDeps {
  db: DbClient;
  router: Router;
  pluginRegistry: PluginRegistry;
  rateLimiter?: RateLimiter;
  budgetChecker?: BudgetChecker;
}

interface LogFields {
  apiKeyId: string;
  modelName: string;
  latencyMs: number;
  status: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheHit: boolean;
  stream: boolean;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

function estimateInputTokens(req: EmbeddingRequest): number {
  const inputs = Array.isArray(req.input) ? req.input : [req.input];
  const chars = inputs.reduce((sum, text) => sum + text.length, 0);
  return Math.ceil(chars / 4);
}

function isModelAllowed(
  modelName: string,
  allowedModels: string[] | undefined,
): boolean {
  if (!allowedModels || allowedModels.length === 0) {
    return true;
  }
  return allowedModels.includes(modelName);
}

export function registerEmbeddingsRoute(
  app: FastifyInstance,
  deps: EmbeddingsRouteDeps,
): void {
  app.post("/v1/embeddings", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }

    const body = request.body as EmbeddingRequest;

    const keyAllowed = isModelAllowed(body.model, auth.allowedModels);
    const teamAllowed = isModelAllowed(body.model, auth.teamAllowedModels);
    if (!keyAllowed || !teamAllowed) {
      return sendError(reply, new ModelAccessDeniedError(body.model));
    }

    const requestCtx: RequestContext = {
      apiKeyId: auth.apiKeyId,
      model: body.model,
      headers: request.headers as Record<string, string>,
      body,
    };

    const pluginResponse = await deps.pluginRegistry.runOnRequest(requestCtx);
    if (pluginResponse) {
      return await reply
        .status(pluginResponse.status)
        .send(pluginResponse.body);
    }

    const startedAt = Date.now();

    const log = (
      fields: Omit<LogFields, "apiKeyId" | "modelName" | "latencyMs">,
    ) =>
      deps.db.requestLog.create({
        data: {
          apiKeyId: auth.apiKeyId,
          modelName: body.model,
          latencyMs: Date.now() - startedAt,
          ...fields,
        },
      });

    try {
      await deps.rateLimiter?.checkAndRecord(auth.apiKeyId, auth.rpmLimit);
      await deps.rateLimiter?.checkTokens(
        auth.apiKeyId,
        estimateInputTokens(body),
        auth.tpmLimit,
      );

      const response = await deps.router.executeEmbeddings(body);

      await deps.rateLimiter?.recordTokens(
        auth.apiKeyId,
        response.usage.total_tokens,
      );
      await deps.budgetChecker?.checkAndSpend(
        auth.apiKeyId,
        body.model,
        response.usage.prompt_tokens,
        0,
        auth.budgetLimit,
        auth.teamId,
        auth.teamBudgetLimit,
      );

      await log({
        status: 200,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: 0,
        cacheHit: false,
        stream: false,
      });

      const finalResponse = await deps.pluginRegistry.runOnResponse(
        requestCtx,
        { status: 200, body: response },
      );
      return await reply.status(finalResponse.status).send(finalResponse.body);
    } catch (err) {
      await log({
        status: statusForError(err),
        cacheHit: false,
        stream: false,
      });
      return sendError(reply, err);
    }
  });
}
