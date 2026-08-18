// src/plugins/registry.ts
import type {
  ProviderPlugin,
  MiddlewarePlugin,
  RequestContext,
  GatewayResponse,
} from "@ai-gateway/plugin-sdk";

import type { Provider } from "../types/provider.js";

export interface PluginRegistry {
  registerProvider(plugin: ProviderPlugin): void;
  getProvider(name: string): Provider | undefined;
  createProviderInstance(name: string, config: unknown): Provider | undefined;
  instantiate(name: string, config: unknown): Provider | undefined;
  registerMiddleware(plugin: MiddlewarePlugin): void;
  runOnRequest(ctx: RequestContext): Promise<GatewayResponse | undefined>;
  runOnResponse(
    ctx: RequestContext,
    response: GatewayResponse,
  ): Promise<GatewayResponse>;
}

export function createPluginRegistry(): PluginRegistry {
  const providerPlugins = new Map<string, ProviderPlugin>();
  const instantiatedProviders = new Map<string, Provider>();
  const middlewarePlugins: MiddlewarePlugin[] = [];

  return {
    registerProvider(plugin: ProviderPlugin): void {
      providerPlugins.set(plugin.name, plugin);
    },

    getProvider(name: string): Provider | undefined {
      return instantiatedProviders.get(name);
    },

    createProviderInstance(
      name: string,
      config: unknown,
    ): Provider | undefined {
      const plugin = providerPlugins.get(name);
      if (!plugin) {
        return undefined;
      }
      const instance = plugin.createProvider(config);
      instantiatedProviders.set(name, instance);
      return instance;
    },

    instantiate(name: string, config: unknown): Provider | undefined {
      const plugin = providerPlugins.get(name);
      if (!plugin) {
        return undefined;
      }
      return plugin.createProvider(config);
    },

    registerMiddleware(plugin: MiddlewarePlugin): void {
      middlewarePlugins.push(plugin);
    },

    async runOnRequest(
      ctx: RequestContext,
    ): Promise<GatewayResponse | undefined> {
      for (const plugin of middlewarePlugins) {
        if (!plugin.onRequest) {
          continue;
        }
        try {
          const result = await plugin.onRequest(ctx);
          if (result) {
            return result;
          }
        } catch (err) {
          // A throwing plugin degrades gracefully — logged, treated as
          // "this plugin had nothing to say," never a process crash.
          console.error(
            `Middleware plugin "${plugin.name}" threw in onRequest:`,
            err,
          );
        }
      }
      return undefined;
    },

    async runOnResponse(
      ctx: RequestContext,
      response: GatewayResponse,
    ): Promise<GatewayResponse> {
      let current = response;
      for (const plugin of middlewarePlugins) {
        if (!plugin.onResponse) {
          continue;
        }
        try {
          current = await plugin.onResponse(ctx, current);
        } catch (err) {
          // A throwing plugin degrades gracefully — the original response is
          // passed through unchanged.
          console.error(
            `Middleware plugin "${plugin.name}" threw in onResponse:`,
            err,
          );
        }
      }
      return current;
    },
  };
}
