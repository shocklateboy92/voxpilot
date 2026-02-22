import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { closeDb, getDb } from "./db";
import { artifactRouter } from "./routes/artifacts";
import { chatRouter } from "./routes/chat";
import { healthRouter } from "./routes/health";
import { sessionsRouter } from "./routes/sessions";

// Chain .route() calls so Hono's type system propagates route
// definitions — required for the frontend hc<AppType>() RPC client.
const appBase = new Hono();
appBase.use(
  "*",
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
export const app = appBase
  .route("/", healthRouter)
  .route("/", sessionsRouter)
  .route("/", chatRouter)
  .route("/", artifactRouter);

export type AppType = typeof app;

// Initialize the db so any errors happen
// before we start accepting requests.
getDb();

process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});

export default {
  port: 8000,
  fetch: app.fetch,
  idleTimeout: 255, // seconds — max value; keeps SSE connections alive
  onListen(server: { hostname: string; port: number }) {
    console.log(
      `${config.appName} listening on http://${server.hostname}:${server.port} (debug=${String(config.debug)})`,
    );
  },
};
