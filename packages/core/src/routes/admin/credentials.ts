import type {
  CreateProviderCredentialRequest,
  UpdateProviderCredentialRequest,
  ProviderCredentialProvider,
} from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import { encryptConfig, decryptConfig } from "../../credentials/encryption.js";
import type { DbClient } from "../../db/client.js";
import {
  statusForError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../../errors.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { Provider } from "../../types/provider.js";

export interface AdminCredentialsRouteDeps {
  db: DbClient;
  registry: PluginRegistry;
  providers: Map<string, Provider>;
  encryptionKey: string | undefined;
}

const REQUIRED_CONFIG_KEYS: Record<ProviderCredentialProvider, string[]> = {
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  gemini: ["apiKey"],
  bedrock: ["accessKeyId", "secretAccessKey", "region"],
  "azure-openai": ["apiKey", "resourceName", "apiVersion"],
};

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

function toDto(row: {
  id: string;
  provider: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateConfig(
  provider: string,
  config: Record<string, string>,
): void {
  const required = REQUIRED_CONFIG_KEYS[provider as ProviderCredentialProvider];
  if (!required) {
    throw new ValidationError(`Unknown provider "${provider}"`);
  }
  for (const key of required) {
    if (typeof config[key] !== "string" || config[key].length === 0) {
      throw new ValidationError(
        `config.${key} is required for provider "${provider}"`,
      );
    }
  }
}

function requireEncryptionKey(encryptionKey: string | undefined): string {
  if (!encryptionKey) {
    throw new ValidationError(
      "CREDENTIAL_ENCRYPTION_KEY is not configured on this server",
    );
  }
  return encryptionKey;
}

async function refreshOne(
  deps: AdminCredentialsRouteDeps,
  id: string,
  row: {
    provider: string;
    configCiphertext: string;
    configIv: string;
    configAuthTag: string;
  } | null,
): Promise<void> {
  if (!row) {
    deps.providers.delete(id);
    return;
  }
  const keyHex = requireEncryptionKey(deps.encryptionKey);
  const config = decryptConfig(
    row.configCiphertext,
    row.configIv,
    row.configAuthTag,
    keyHex,
  );
  const instance = deps.registry.instantiate(row.provider, config);
  if (instance) {
    deps.providers.set(id, instance);
  }
}

export function registerAdminCredentialsRoute(
  app: FastifyInstance,
  deps: AdminCredentialsRouteDeps,
): void {
  app.get("/admin/credentials", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const rows = await deps.db.providerCredential.findMany();
      return reply.status(200).send({ object: "list", data: rows.map(toDto) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/credentials", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as Partial<CreateProviderCredentialRequest>;
      if (!body.provider || !body.name || !body.config) {
        return sendError(
          reply,
          new ValidationError("provider, name, and config are required"),
        );
      }
      validateConfig(body.provider, body.config);
      const keyHex = requireEncryptionKey(deps.encryptionKey);
      const { ciphertext, iv, authTag } = encryptConfig(body.config, keyHex);

      const row = await deps.db.providerCredential.create({
        data: {
          provider: body.provider,
          name: body.name,
          configCiphertext: ciphertext,
          configIv: iv,
          configAuthTag: authTag,
        },
      });
      await refreshOne(deps, row.id, row);

      return reply.status(201).send(toDto(row));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/credentials/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.providerCredential.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "credential not found" });
      }

      const body = request.body as UpdateProviderCredentialRequest;
      const data: Record<string, unknown> = {};
      if (body.name !== undefined) {
        data.name = body.name;
      }
      if (body.config !== undefined) {
        validateConfig(existing.provider, body.config);
        const keyHex = requireEncryptionKey(deps.encryptionKey);
        const { ciphertext, iv, authTag } = encryptConfig(body.config, keyHex);
        data.configCiphertext = ciphertext;
        data.configIv = iv;
        data.configAuthTag = authTag;
      }

      const row = await deps.db.providerCredential.update({
        where: { id },
        data,
      });
      await refreshOne(deps, id, row);

      return reply.status(200).send(toDto(row));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/admin/credentials/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.providerCredential.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "credential not found" });
      }

      const blockingDeployments = await deps.db.deployment.findMany({
        where: { credentialsRef: id },
      });
      if (blockingDeployments.length > 0) {
        return sendError(
          reply,
          new ConflictError(
            `Credential is in use by ${blockingDeployments.length} deployment(s)`,
          ),
        );
      }

      await deps.db.providerCredential.delete({ where: { id } });
      await refreshOne(deps, id, null);

      return reply.status(204).send();
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
