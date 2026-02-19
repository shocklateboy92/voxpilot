import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { closeDb, initDb } from "./db";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { chatRouter } from "./routes/chat";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.corsOrigins,
  }),
);

app.route("/", healthRouter);
app.route("/", authRouter);
app.route("/", sessionsRouter);
app.route("/", chatRouter);

initDb(config.dbPath);
console.log(
  `${config.appName} listening on http://localhost:8000 (debug=${String(config.debug)})`,
);

process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});

export default {
  port: 8000,
  fetch: app.fetch,
  idleTimeout: 255, // seconds — max value; keeps SSE connections alive
};
