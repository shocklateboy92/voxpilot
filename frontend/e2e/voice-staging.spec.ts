import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SpeechConnection } from "../../plugin/src/speech-contract";
import { expect, idle, test } from "./browser";
import { password } from "./dev";

// Explicit opt-in: real paid transcription, but only synthetic test audio.
// Traces must never capture the deployment's browser-readable speech token.
test.skip(
  process.env.VOXPILOT_STAGING_SPEECH_SMOKE !== "1",
  "Requires explicit chapel cloud smoke opt-in",
);
test.use({ trace: "off", video: "off", screenshot: "off" });

test("synthetic recording reaches chapel OpenAI and the isolated native chat flow", async ({
  app,
  baseURL,
  workspace,
}) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Missing isolated browser frontend");
  const preview = "https://voxpilot-dev.staging.lasath.com";
  const response = await fetch(`${preview}/config.json`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const config: unknown = await response.json();
  if (
    !response.ok ||
    !config ||
    typeof config !== "object" ||
    !("speech" in config)
  )
    throw new Error("Chapel speech preview configuration is unavailable");
  const parsed = SpeechConnection.safeParse(config.speech);
  if (
    !parsed.success ||
    parsed.data.url !== "https://speech.staging.lasath.com"
  )
    throw new Error("Expected the chapel-only speech endpoint");
  const speech = parsed.data;
  const vocabularyDirectory = join(workspace.directory, ".voxpilot");
  await mkdir(vocabularyDirectory, { recursive: true });
  await writeFile(
    join(vocabularyDirectory, "vocabulary.json"),
    JSON.stringify(["VoxPilot"]),
  );

  await app.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [
          {
            id: "staging-smoke",
            name: "Isolated test backend",
            url: baseURL,
            password,
          },
        ],
        speech,
      },
    }),
  );
  // Bridge the isolated HTTP test origin to the already-verified HTTPS service.
  // Bodies/auth come from the real browser client, not a synthetic RPC response.
  await app.route(`${speech.url}/v1/**`, async (route) => {
    const request = route.request();
    const headers = new Headers(request.headers());
    headers.set("Origin", preview);
    const data = request.postDataBuffer();
    const upstream = await fetch(request.url(), {
      method: request.method(),
      headers,
      body: data ? new Uint8Array(data) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    await route.fulfill({
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": new URL(baseURL).origin,
      },
      body: Buffer.from(await upstream.arrayBuffer()),
    });
  });
  await app.evaluate(() =>
    localStorage.setItem("voxpilot:serverId", "staging-smoke"),
  );
  await app.reload();
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(workspace.directory);
  await app.getByRole("button", { name: "Voice", exact: true }).click();

  const raw = execFileSync("espeak-ng", [
    "--stdout",
    "-s",
    "145",
    "VoxPilot staging check. Please reply with exactly speech verified. Do not change any files.",
  ]);
  await app.evaluate((bytes) => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const source = context.createBufferSource();
        source.buffer = await context.decodeAudioData(
          new Uint8Array(bytes).buffer,
        );
        source.connect(destination);
        source.start(context.currentTime + 0.15);
        return destination.stream;
      },
    });
  }, Array.from(raw));
  await app
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  const finish = app.getByRole("button", {
    name: "Finish recording",
    exact: true,
  });
  await expect(finish).toBeEnabled();
  await expect
    .poll(() => app.getByRole("timer").textContent(), { timeout: 15_000 })
    .toBe("0:08");
  await finish.click();
  await expect(app.locator(".message.user")).toHaveCount(1);
  await expect(app.locator(".message.user")).toContainText(/VoxPilot/i);
  await expect(app.locator(".message.user")).toContainText(
    /not change any files/i,
  );
  await app.getByRole("button", { name: "Type", exact: true }).click();
  await idle(app);
  await expect(app.locator(".message.assistant").last()).toContainText(
    /speech verified/i,
  );
  await expect(
    app.getByRole("button", { name: "Discard recording", exact: true }),
  ).toHaveCount(0);
});
