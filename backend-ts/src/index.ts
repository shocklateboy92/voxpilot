import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { closeDb, initDb } from "./db";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.corsOrigins,
  }),
);

app.get("/", (c) => {
  return c.json({ name: config.appName, status: "ok" });
});

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
};
