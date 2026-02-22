import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { closeDb, getDb } from "./db";
import { authMiddleware, type AuthEnv } from "./middleware/auth";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { chatRouter } from "./routes/chat";
import { artifactRouter } from "./routes/artifacts";

// Protected routes — authMiddleware is applied once here so individual
// routers don't need to add it themselves.
const protectedBase = new Hono<AuthEnv>();
protectedBase.use("*", authMiddleware);
const protectedRouter = protectedBase
  .route("/", sessionsRouter)
  .route("/", chatRouter)
  .route("/", artifactRouter);

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
  .route("/", authRouter)
  .route("/", protectedRouter);

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
