import type {
  CreateDeploymentRequest,
  UpdateDeploymentRequest,
} from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  statusForError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";
import { getDeploymentHealth } from "../../router/deploymentHealth.js";
import type { RedisLike } from "../../router/router.js";

export interface AdminDeploymentsRouteDeps {
  db: DbClient;
  redis: RedisLike;
}

type CreateDeploymentBody = Partial<CreateDeploymentRequest>;
type UpdateDeploymentBody = UpdateDeploymentRequest;

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

function extractBearerToken(request: {
  headers: { authorization?: string };
}): string | undefined {
  const authHeader = request.headers.authorization;
  return authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;
}

const KNOWN_PROVIDER_TYPES = [
  "openai",
  "anthropic",
  "bedrock",
  "azure-openai",
  "gemini",
];

async function validateCredentialsRef(
  db: DbClient,
  provider: string,
  credentialsRef: string,
): Promise<void> {
  if (credentialsRef.startsWith("env:")) {
    const providerType = credentialsRef.slice("env:".length);
    if (!KNOWN_PROVIDER_TYPES.includes(providerType)) {
      throw new ValidationError(
        `Unknown provider type "${providerType}" in credentialsRef`,
      );
    }
    return;
  }
  const credential = await db.providerCredential.findUnique({
    where: { id: credentialsRef },
  });
  if (!credential || credential.provider !== provider) {
    throw new ValidationError(
      `credentialsRef "${credentialsRef}" does not match a known credential for provider "${provider}"`,
    );
  }
}

function validateCreateBody(body: CreateDeploymentBody): {
  modelName: string;
  provider: string;
  providerModelId: string;
  credentialsRef: string;
  weight: number;
  isActive: boolean;
} {
  const requiredFields = [
    "modelName",
    "provider",
    "providerModelId",
    "credentialsRef",
  ] as const;
  for (const field of requiredFields) {
    const value = body[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new ValidationError(`${field} is required`);
    }
  }

  const weight = typeof body.weight === "number" ? body.weight : 1;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

  return {
    modelName: body.modelName as string,
    provider: body.provider as string,
    providerModelId: body.providerModelId as string,
    credentialsRef: body.credentialsRef as string,
    weight,
    isActive,
  };
}

export function registerAdminDeploymentsRoute(
  app: FastifyInstance,
  deps: AdminDeploymentsRouteDeps,
): void {
  app.get("/admin/deployments", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const deployments = await deps.db.deployment.findMany({
        orderBy: { modelName: "asc" },
      });
      const health = await getDeploymentHealth(
        deps.redis,
        deployments.map((d) => d.id),
      );

      return reply.status(200).send({
        object: "list",
        data: deployments.map((d) => ({
          ...d,
          health: health.get(d.id) ?? "healthy",
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/deployments/health", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const deployments = await deps.db.deployment.findMany({
        select: { id: true },
      });
      const health = await getDeploymentHealth(
        deps.redis,
        deployments.map((d) => d.id),
      );

      return reply.status(200).send({
        object: "list",
        data: deployments.map((d) => ({
          id: d.id,
          health: health.get(d.id) ?? "healthy",
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/deployments", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateDeploymentBody;
      const data = validateCreateBody(body);
      await validateCredentialsRef(deps.db, data.provider, data.credentialsRef);

      const deployment = await deps.db.deployment.create({ data });
      return reply.status(201).send(deployment);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/deployments/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const deployment = await deps.db.deployment.findUnique({ where: { id } });

      if (!deployment) {
        return reply.status(404).send({ error: "deployment not found" });
      }

      const health = await getDeploymentHealth(deps.redis, [deployment.id]);
      return reply.status(200).send({
        ...deployment,
        health: health.get(deployment.id) ?? "healthy",
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/deployments/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const body = request.body as UpdateDeploymentBody;

      const existing = await deps.db.deployment.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "deployment not found" });
      }

      const updateData: Partial<{
        modelName: string;
        provider: string;
        providerModelId: string;
        credentialsRef: string;
        weight: number;
        isActive: boolean;
      }> = {};

      if (body.modelName !== undefined) {
        if (typeof body.modelName !== "string" || body.modelName.length === 0) {
          return reply
            .status(400)
            .send({ error: "modelName must be a non-empty string" });
        }
        updateData.modelName = body.modelName;
      }
      if (body.provider !== undefined) {
        if (typeof body.provider !== "string" || body.provider.length === 0) {
          return reply
            .status(400)
            .send({ error: "provider must be a non-empty string" });
        }
        updateData.provider = body.provider;
      }
      if (body.providerModelId !== undefined) {
        if (
          typeof body.providerModelId !== "string" ||
          body.providerModelId.length === 0
        ) {
          return reply
            .status(400)
            .send({ error: "providerModelId must be a non-empty string" });
        }
        updateData.providerModelId = body.providerModelId;
      }
      if (body.credentialsRef !== undefined) {
        if (
          typeof body.credentialsRef !== "string" ||
          body.credentialsRef.length === 0
        ) {
          return reply
            .status(400)
            .send({ error: "credentialsRef must be a non-empty string" });
        }
        updateData.credentialsRef = body.credentialsRef;
      }
      if (updateData.credentialsRef !== undefined) {
        await validateCredentialsRef(
          deps.db,
          updateData.provider ?? existing.provider,
          updateData.credentialsRef,
        );
      }
      if (body.weight !== undefined) {
        if (typeof body.weight !== "number" || body.weight < 0) {
          return reply
            .status(400)
            .send({ error: "weight must be a non-negative number" });
        }
        updateData.weight = body.weight;
      }
      if (body.isActive !== undefined) {
        if (typeof body.isActive !== "boolean") {
          return reply
            .status(400)
            .send({ error: "isActive must be a boolean" });
        }
        updateData.isActive = body.isActive;
      }

      const deployment = await deps.db.deployment.update({
        where: { id },
        data: updateData,
      });

      return reply.status(200).send(deployment);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/admin/deployments/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };

      const existing = await deps.db.deployment.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "deployment not found" });
      }

      await deps.db.deployment.update({
        where: { id },
        data: { isActive: false },
      });

      return reply.status(204).send();
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
