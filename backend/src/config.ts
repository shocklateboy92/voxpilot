import { z } from "zod/v4";
import { loadConfigSync } from "zod-config";
import { envAdapter } from "zod-config/env-adapter";

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
  llmDefaultModel: z.string().default("qwen3-coder:30b"),
  dbPath: z.string().default("voxpilot.db"),
  workDir: z.string().default(process.cwd()),
  maxAgentIterations: z
    .string()
    .default("25")
    .transform((v) => Number.parseInt(v, 10)),
  copilotCliPath: z.string().default("copilot"),
});

export type Config = z.infer<typeof configSchema>;

const ENV_PREFIX = "VOXPILOT_";

export const config: Config = loadConfigSync({
  schema: configSchema,
  keyMatching: "lenient",
  adapters: envAdapter({
    regex: /^VOXPILOT_/,
    transform: ({ key, value }) => ({
      key: key.slice(ENV_PREFIX.length),
      value,
    }),
  }),
});
