import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SpeechCapabilities,
  TranscriptionResult,
} from "../../plugin/src/speech-contract";
import { ORIGIN, recording, TOKEN, wav } from "./helpers";

test.skipIf(!existsSync("dist/voxpilot-speech"))(
  "compiled executable embeds VAD and processes synthetic silence",
  async () => {
    await mkdir("/tmp/opencode", { recursive: true });
    const directory = await mkdtemp(
      "/tmp/opencode/voxpilot-speech-artifact-test-",
    );
    const reservation = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(),
    });
    const port = reservation.port;
    await reservation.stop(true);
    await writeFile(join(directory, "speech-token"), TOKEN, { mode: 0o600 });
    await writeFile(
      join(directory, "openai-key"),
      "synthetic-openai-key-not-a-real-key-000000",
      { mode: 0o600 },
    );
    const executable = join(process.cwd(), "dist/voxpilot-speech");
    const subprocess = Bun.spawn([executable], {
      cwd: directory,
      env: {
        PATH: Bun.env.PATH,
        CREDENTIALS_DIRECTORY: directory,
        SPEECH_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
        SPEECH_PORT: String(port),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const url = `http://127.0.0.1:${port}`;
    try {
      let healthy = false;
      for (let i = 0; i < 100; i++) {
        try {
          healthy = (await fetch(`${url}/healthz`)).ok;
        } catch {
          /* Wait only for this synthetic process. */
        }
        if (healthy) break;
        await Bun.sleep(10);
      }
      expect(healthy).toBe(true);
      const healthcheck = Bun.spawn([executable, "healthcheck"], {
        cwd: directory,
        env: { SPEECH_PORT: String(port) },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await healthcheck.exited).toBe(0);
      expect(await new Response(healthcheck.stdout).text()).toBe("");
      expect(await new Response(healthcheck.stderr).text()).toBe("");
      const capabilities = await fetch(`${url}/v1/capabilities`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(SpeechCapabilities.parse(await capabilities.json()).ready).toBe(
        true,
      );
      const template = recording({ audio: wav(0.5) });
      const result = await fetch(`${url}/v1/transcriptions`, {
        method: "POST",
        headers: template.headers,
        body: template.body,
      });
      expect(TranscriptionResult.parse(await result.json()).status).toBe(
        "no_speech",
      );
    } finally {
      subprocess.kill("SIGTERM");
      await subprocess.exited;
      // Only fixed status logs are allowed; synthetic credential strings never appear.
      expect(await new Response(subprocess.stdout).text()).toBe(
        "Speech service ready.\n",
      );
      expect(await new Response(subprocess.stderr).text()).toBe("");
      await rm(directory, { recursive: true, force: true });
    }
  },
);
