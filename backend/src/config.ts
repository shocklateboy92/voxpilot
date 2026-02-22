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
  copilotCliPath: z.string().default("copilot"),
});

export type Config = z.infer<typeof configSchema>;

/** Convert camelCase to SCREAMING_SNAKE_CASE (e.g. "corsOrigins" → "CORS_ORIGINS") */
export function toScreamingSnake(key: string): string {
  return key
    .replace(/[A-Z]/g, (ch) => `_${ch}`)
    .toUpperCase()
    .replace(/^_/, "");
}

/** Read env vars matching `{PREFIX}_{SCREAMING_SNAKE_KEY}` for each key in the schema */
function loadFromEnv(
  schema: z.ZodObject<z.ZodRawShape>,
  prefix: string,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) {
    result[key] = Bun.env[`${prefix}_${toScreamingSnake(key)}`];
  }
  return result;
}

export const config: Config = configSchema.parse(
  loadFromEnv(configSchema, "VOXPILOT"),
);
