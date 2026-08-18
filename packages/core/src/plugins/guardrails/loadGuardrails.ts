import type { DbClient } from "../../db/client.js";
import type { PluginRegistry } from "../registry.js";
import { createKeywordBlockerMiddleware } from "./keywordBlocker.js";

export async function loadGuardrails(
  db: DbClient,
  registry: PluginRegistry,
): Promise<void> {
  const rules = await db.guardrailRule.findMany({
    where: { enabled: true },
  });

  for (const rule of rules) {
    const config = rule.config as Record<string, unknown>;

    if (rule.type === "keyword_block") {
      const keywords = config.keywords;
      if (
        Array.isArray(keywords) &&
        keywords.every((k) => typeof k === "string")
      ) {
        registry.registerMiddleware(
          createKeywordBlockerMiddleware(rule.name, {
            keywords,
            caseSensitive: config.caseSensitive === true,
          }),
        );
      }
    }
  }
}
