import { z } from "zod/v4";

const configSchema = z.object({
  appName: z.string().default("VoxPilot"),
  debug: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  corsOrigins: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.split(",")),
  githubClientId: z.string().default(""),
  githubClientSecret: z.string().default(""),
  dbPath: z.string().default("voxpilot.db"),
  workDir: z.string().default(process.cwd()),
  maxAgentIterations: z
    .string()
    .default("25")
    .transform((v) => Number.parseInt(v, 10)),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const env = Bun.env;
  return configSchema.parse({
    appName: env["VOXPILOT_APP_NAME"],
    debug: env["VOXPILOT_DEBUG"],
    corsOrigins: env["VOXPILOT_CORS_ORIGINS"],
    githubClientId: env["VOXPILOT_GITHUB_CLIENT_ID"],
    githubClientSecret: env["VOXPILOT_GITHUB_CLIENT_SECRET"],
    dbPath: env["VOXPILOT_DB_PATH"],
    workDir: env["VOXPILOT_WORK_DIR"],
    maxAgentIterations: env["VOXPILOT_MAX_AGENT_ITERATIONS"],
  });
}

export const config = loadConfig();
