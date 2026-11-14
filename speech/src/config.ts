import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { SpeechFault } from "./errors";

const Origins = z
  .array(
    z.string().refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["https:", "http:"].includes(url.protocol) &&
          url.origin === value &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }),
  )
  .min(1)
  .max(16);

// Read only by the service. No direct credential-value environment variables.
async function credential(
  env: NodeJS.ProcessEnv,
  variable: string,
  name: string,
) {
  const path =
    env[variable] ??
    (env.CREDENTIALS_DIRECTORY
      ? join(env.CREDENTIALS_DIRECTORY, name)
      : undefined);
  if (!path || !isAbsolute(path)) throw new SpeechFault("unavailable");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    // systemd credentials may be root-owned; both root and the service UID are trusted.
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (stat.uid !== process.getuid?.() && stat.uid !== 0) ||
      stat.size > 4096 ||
      stat.size === 0
    ) {
      throw new SpeechFault("unavailable");
    }
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size || bytesRead > 4096)
      throw new SpeechFault("unavailable");
    const value = bytes.toString("utf8", 0, bytesRead).trim();
    if (!/^[\x21-\x7e]{32,256}$/.test(value))
      throw new SpeechFault("unavailable");
    return value;
  } finally {
    await file.close();
  }
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  try {
    const origins = Origins.parse(
      JSON.parse(env.SPEECH_ALLOWED_ORIGINS ?? "[]"),
    );
    const port = z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.SPEECH_PORT ?? "8789");
    const hostname = z
      .string()
      .min(1)
      .max(255)
      .parse(env.SPEECH_HOST ?? "127.0.0.1");
    const token = await credential(env, "SPEECH_TOKEN_FILE", "speech-token");
    const key = await credential(env, "OPENAI_API_KEY_FILE", "openai-key");
    return {
      origins,
      port,
      hostname,
      token,
      key,
      ffmpeg: env.SPEECH_FFMPEG ?? "ffmpeg",
    };
  } catch {
    throw new SpeechFault("unavailable");
  }
}
