import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { closeDb, getDb } from "./db";
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

app.route("/", healthRouter);
app.route("/", authRouter);
app.route("/", sessionsRouter);
app.route("/", chatRouter);
app.route("/", artifactRouter);

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
