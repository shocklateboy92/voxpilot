import { afterEach, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { ORIGIN, TOKEN } from "./helpers";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/voxpilot-speech-config-test-");
  directories.push(directory);
  await writeFile(join(directory, "speech-token"), `${TOKEN}\n`, {
    mode: 0o600,
  });
  await writeFile(
    join(directory, "openai-key"),
    "synthetic-openai-key-not-a-real-key-000000\n",
    { mode: 0o400 },
  );
  return directory;
}

test("service reads synthetic private file credentials, including systemd naming", async () => {
  const directory = await fixture();
  const config = await loadConfig({
    CREDENTIALS_DIRECTORY: directory,
    SPEECH_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
  });
  expect(config.token).toBe(TOKEN);
  expect(config.port).toBe(8789);
  expect(config.hostname).toBe("127.0.0.1");
  const explicit = await loadConfig({
    SPEECH_TOKEN_FILE: join(directory, "speech-token"),
    OPENAI_API_KEY_FILE: join(directory, "openai-key"),
    SPEECH_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
    SPEECH_PORT: "9999",
  });
  expect(explicit.port).toBe(9999);
});

test("public files, symlinks and plain credential-value environment variables fail closed", async () => {
  const directory = await fixture();
  const env = {
    CREDENTIALS_DIRECTORY: directory,
    SPEECH_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
  };
  await chmod(join(directory, "speech-token"), 0o644);
  await expect(loadConfig(env)).rejects.toMatchObject({ code: "unavailable" });
  await chmod(join(directory, "speech-token"), 0o600);
  await symlink(
    join(directory, "speech-token"),
    join(directory, "linked-token"),
  );
  await expect(
    loadConfig({ ...env, SPEECH_TOKEN_FILE: join(directory, "linked-token") }),
  ).rejects.toMatchObject({ code: "unavailable" });
  await expect(
    loadConfig({
      SPEECH_TOKEN: TOKEN,
      OPENAI_API_KEY: "synthetic",
      SPEECH_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
    }),
  ).rejects.toMatchObject({ code: "unavailable" });
});

test("non-exact origins, oversized credential files and invalid ports are rejected", async () => {
  const directory = await fixture();
  const env = {
    CREDENTIALS_DIRECTORY: directory,
    SPEECH_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
  };
  for (const origin of [
    "*",
    "null",
    `${ORIGIN}/`,
    `${ORIGIN}/path`,
    "https://user:pass@example.test",
  ]) {
    await expect(
      loadConfig({ ...env, SPEECH_ALLOWED_ORIGINS: JSON.stringify([origin]) }),
    ).rejects.toMatchObject({ code: "unavailable" });
  }
  await expect(
    loadConfig({ ...env, SPEECH_PORT: "65536" }),
  ).rejects.toMatchObject({ code: "unavailable" });
  await writeFile(join(directory, "speech-token"), "x".repeat(4097));
  await expect(loadConfig(env)).rejects.toMatchObject({ code: "unavailable" });
});
