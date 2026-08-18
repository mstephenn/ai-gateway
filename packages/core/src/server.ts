import { buildApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const deps = await bootstrap();
  const app = await buildApp(deps);
  const port = parseInt(process.env.PORT || "4000", 10);

  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
