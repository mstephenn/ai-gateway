import type { RedisLike } from "./router.js";

export function cooldownKey(deploymentId: string): string {
  return `deployment:cooldown:${deploymentId}`;
}

export type DeploymentHealthStatus = "healthy" | "cooldown";

export async function getDeploymentHealth(
  redis: RedisLike,
  deploymentIds: string[],
): Promise<Map<string, DeploymentHealthStatus>> {
  const result = new Map<string, DeploymentHealthStatus>();
  await Promise.all(
    deploymentIds.map(async (id) => {
      const cooling = await redis.get(cooldownKey(id));
      result.set(id, cooling ? "cooldown" : "healthy");
    }),
  );
  return result;
}
