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
  githubClientId: z.string().default(""),
  githubClientSecret: z.string().default(""),
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
    regex: new RegExp(`^${ENV_PREFIX}`),
    transform: ({ key, value }) => ({
      key: key.slice(ENV_PREFIX.length),
      value,
    }),
  }),
});
