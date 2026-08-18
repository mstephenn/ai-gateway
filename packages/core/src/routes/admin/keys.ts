import { createHash, randomBytes } from "node:crypto";

import type {
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
} from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
} from "../../errors.js";

export interface AdminKeysRouteDeps {
  db: DbClient;
}

type CreateKeyBody = CreateApiKeyRequest;
type UpdateKeyBody = UpdateApiKeyRequest;

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

function generateRawKey(): string {
  return `ak-${randomBytes(16).toString("hex")}`;
}

function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function keyPrefix(token: string): string {
  return token.slice(0, 7);
}

export function registerAdminKeysRoute(
  app: FastifyInstance,
  deps: AdminKeysRouteDeps,
): void {
  app.post("/admin/keys", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }
    if (!auth.isAdmin) {
      return sendError(reply, new ForbiddenError("admin_required"));
    }

    const body = request.body as CreateKeyBody;

    if (body.teamId) {
      const team = await deps.db.team.findUnique({
        where: { id: body.teamId },
      });
      if (!team) {
        return reply.status(400).send({ error: "team not found" });
      }
    }

    const rawKey = generateRawKey();
    const key = await deps.db.apiKey.create({
      data: {
        name: body.name,
        teamId: body.teamId,
        keyHash: hashKey(rawKey),
        keyPrefix: keyPrefix(rawKey),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        budgetLimit: body.budgetLimit ?? null,
        rpmLimit: body.rpmLimit ?? null,
        tpmLimit: body.tpmLimit ?? null,
        allowedModels: body.allowedModels ?? [],
      },
      include: { team: true },
    });

    return reply.status(201).send({
      id: key.id,
      name: key.name,
      teamId: key.teamId,
      teamName: key.team?.name ?? null,
      key: rawKey,
      keyPrefix: key.keyPrefix,
      isActive: key.isActive,
      expiresAt: key.expiresAt,
      budgetLimit: key.budgetLimit,
      rpmLimit: key.rpmLimit,
      tpmLimit: key.tpmLimit,
      allowedModels: key.allowedModels,
      createdAt: key.createdAt,
    });
  });

  app.get("/admin/keys", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }
    if (!auth.isAdmin) {
      return sendError(reply, new ForbiddenError("admin_required"));
    }

    const keys = await deps.db.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: { team: true },
    });

    return reply.status(200).send({
      object: "list",
      data: keys.map((key) => ({
        id: key.id,
        name: key.name,
        teamId: key.teamId,
        teamName: key.team?.name ?? null,
        keyPrefix: key.keyPrefix,
        isActive: key.isActive,
        expiresAt: key.expiresAt,
        budgetLimit: key.budgetLimit,
        rpmLimit: key.rpmLimit,
        tpmLimit: key.tpmLimit,
        allowedModels: key.allowedModels,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      })),
    });
  });

  app.delete("/admin/keys/:id", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }
    if (!auth.isAdmin) {
      return sendError(reply, new ForbiddenError("admin_required"));
    }

    const { id } = request.params as { id: string };

    await deps.db.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    return reply.status(204).send();
  });

  app.post("/admin/keys/:id/rotate", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }
    if (!auth.isAdmin) {
      return sendError(reply, new ForbiddenError("admin_required"));
    }

    const { id } = request.params as { id: string };

    const oldKey = await deps.db.apiKey.findUnique({ where: { id } });
    if (!oldKey) {
      return reply.status(404).send({ error: "key not found" });
    }

    const rawKey = generateRawKey();
    const [newKey] = await deps.db.$transaction([
      deps.db.apiKey.create({
        data: {
          name: oldKey.name,
          teamId: oldKey.teamId,
          keyHash: hashKey(rawKey),
          keyPrefix: keyPrefix(rawKey),
          expiresAt: oldKey.expiresAt,
          budgetLimit: oldKey.budgetLimit,
          rpmLimit: oldKey.rpmLimit,
          tpmLimit: oldKey.tpmLimit,
          allowedModels: oldKey.allowedModels,
        },
        include: { team: true },
      }),
      deps.db.apiKey.update({
        where: { id: oldKey.id },
        data: { isActive: false },
      }),
    ]);

    return reply.status(201).send({
      id: newKey.id,
      name: newKey.name,
      teamId: newKey.teamId,
      teamName: newKey.team?.name ?? null,
      key: rawKey,
      keyPrefix: newKey.keyPrefix,
      isActive: newKey.isActive,
      expiresAt: newKey.expiresAt,
      budgetLimit: newKey.budgetLimit,
      rpmLimit: newKey.rpmLimit,
      tpmLimit: newKey.tpmLimit,
      allowedModels: newKey.allowedModels,
      createdAt: newKey.createdAt,
    });
  });

  app.patch("/admin/keys/:id", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }
    if (!auth.isAdmin) {
      return sendError(reply, new ForbiddenError("admin_required"));
    }

    const { id } = request.params as { id: string };
    const oldKey = await deps.db.apiKey.findUnique({ where: { id } });
    if (!oldKey) {
      return reply.status(404).send({ error: "key not found" });
    }

    const body = request.body as UpdateKeyBody;

    if (body.teamId) {
      const team = await deps.db.team.findUnique({
        where: { id: body.teamId },
      });
      if (!team) {
        return reply.status(400).send({ error: "team not found" });
      }
    }

    const data: any = {};
    if (body.name !== undefined) {
      data.name = body.name;
    }
    if (body.teamId !== undefined) {
      data.teamId = body.teamId;
    }
    if (body.expiresAt !== undefined) {
      data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }
    if (body.budgetLimit !== undefined) {
      data.budgetLimit = body.budgetLimit;
    }
    if (body.rpmLimit !== undefined) {
      data.rpmLimit = body.rpmLimit;
    }
    if (body.tpmLimit !== undefined) {
      data.tpmLimit = body.tpmLimit;
    }
    if (body.allowedModels !== undefined) {
      data.allowedModels = body.allowedModels;
    }

    const updated = await deps.db.apiKey.update({
      where: { id },
      data,
      include: { team: true },
    });

    return reply.status(200).send({
      id: updated.id,
      name: updated.name,
      teamId: updated.teamId,
      teamName: updated.team?.name ?? null,
      keyPrefix: updated.keyPrefix,
      isActive: updated.isActive,
      expiresAt: updated.expiresAt,
      budgetLimit: updated.budgetLimit,
      rpmLimit: updated.rpmLimit,
      tpmLimit: updated.tpmLimit,
      allowedModels: updated.allowedModels,
      createdAt: updated.createdAt,
      lastUsedAt: updated.lastUsedAt,
    });
  });
}
