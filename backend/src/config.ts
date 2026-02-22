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
  llmBaseUrl: z.string().default("http://localhost:11434/v1"),
  llmApiKey: z.string().default("ollama"),
  llmDefaultModel: z.string().default("qwen3-coder:32b"),
  dbPath: z.string().default("voxpilot.db"),
  workDir: z.string().default(process.cwd()),
  maxAgentIterations: z
    .string()
    .default("25")
    .transform((v) => Number.parseInt(v, 10)),
  copilotCliPath: z.string().default("copilot"),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const env = Bun.env;
  return configSchema.parse({
    appName: env["VOXPILOT_APP_NAME"],
    debug: env["VOXPILOT_DEBUG"],
    corsOrigins: env["VOXPILOT_CORS_ORIGINS"],
    llmBaseUrl: env["VOXPILOT_LLM_BASE_URL"],
    llmApiKey: env["VOXPILOT_LLM_API_KEY"],
    llmDefaultModel: env["VOXPILOT_LLM_DEFAULT_MODEL"],
    dbPath: env["VOXPILOT_DB_PATH"],
    workDir: env["VOXPILOT_WORK_DIR"],
    maxAgentIterations: env["VOXPILOT_MAX_AGENT_ITERATIONS"],
    copilotCliPath: env["VOXPILOT_COPILOT_CLI_PATH"],
  });
}

export const config = loadConfig();
