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

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);

// Public routes
app.route("/", healthRouter);
app.route("/", authRouter);

// Protected routes — authMiddleware is applied once here so individual
// routers don't need to add it themselves.
const protectedRouter = new Hono<AuthEnv>();
protectedRouter.use("*", authMiddleware);
protectedRouter.route("/", sessionsRouter);
protectedRouter.route("/", chatRouter);
protectedRouter.route("/", artifactRouter);
app.route("/", protectedRouter);

// Initialize the db so any errors happen
// before we start accepting requests.
getDb();

process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});

export type AppType = typeof app;

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
