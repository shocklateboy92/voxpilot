import { createAcousticGuard } from "./acoustic";
import { loadConfig } from "./config";
import { failure, SpeechFault } from "./errors";
import { createOpenAIProvider } from "./provider";
import { createSpeechService, MAX_REQUEST_BYTES } from "./service";

if (process.argv[2] === "healthcheck") {
  try {
    const port = Number(process.env.SPEECH_PORT ?? "8789");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid healthcheck port.");
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(3000),
      redirect: "error",
      credentials: "omit",
    });
    process.exitCode = response.ok ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
} else {
  try {
    const config = await loadConfig();
    const guard = await createAcousticGuard(config.ffmpeg);
    const service = createSpeechService({
      token: config.token,
      origins: config.origins,
      guard,
      provider: createOpenAIProvider(config.key),
    });
    const server = Bun.serve({
      hostname: config.hostname,
      port: config.port,
      fetch: service.fetch,
      maxRequestBodySize: MAX_REQUEST_BYTES,
      idleTimeout: 125,
      error: () => {
        const outcome = failure(new SpeechFault("internal_error"));
        return Response.json(outcome.body, {
          status: outcome.status,
          headers: { "Cache-Control": "no-store" },
        });
      },
    });
    const shutdown = () => {
      service.close();
      void server.stop(true);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    // Fixed status only. Never log configuration, URLs, IDs, upstream responses,
    // exceptions, credentials, vocabulary, audio, or transcription content.
    console.info("Speech service ready.");
  } catch {
    console.error(
      "Speech service startup failed; check private credential files and configuration.",
    );
    process.exitCode = 1;
  }
}
