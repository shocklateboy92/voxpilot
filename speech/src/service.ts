import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  SPEECH_MAX_BYTES,
  SPEECH_MAX_SECONDS,
  SPEECH_MAX_TERMS,
  SPEECH_MAX_VOCABULARY_CHARACTERS,
  SPEECH_PATHS,
  SPEECH_PROTOCOL,
  SpeechCancellation,
  SpeechCapabilities,
  TranscriptionRequest,
  TranscriptionResult,
} from "../../plugin/src/speech-contract";
import type { AcousticGuard } from "./acoustic";
import { failure, readBounded, SpeechFault, throwIfAborted } from "./errors";
import type { Provider } from "./provider";

export const MAX_REQUEST_BYTES = SPEECH_MAX_BYTES + 64 * 1024;
const CACHE_TTL = 15 * 60 * 1000;
type Outcome = {
  status: number;
  body:
    | z.infer<typeof TranscriptionResult>
    | ReturnType<typeof failure>["body"];
};
type Entry = {
  fingerprint?: string;
  promise: Promise<Outcome>;
  expires: number;
  controller?: AbortController;
  expiryTimer?: ReturnType<typeof setTimeout>;
  providerMayHaveProcessed: boolean;
};
export type ServiceOptions = {
  token: string;
  origins: readonly string[];
  guard: AcousticGuard;
  provider: Provider;
  ready?: boolean;
  timeoutMs?: number;
  cacheSize?: number;
  now?: () => number;
};

class Bucket {
  private tokens: number;
  private updated: number;
  constructor(
    private readonly capacity: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacity;
    this.updated = now();
  }
  take() {
    const current = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens +
        (Math.max(0, current - this.updated) * this.capacity) / 60000,
    );
    this.updated = current;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

export function createSpeechService(options: ServiceOptions) {
  const tokenHash = createHash("sha256")
    .update(`Bearer ${options.token}`)
    .digest();
  const origins = new Set(options.origins);
  const entries = new Map<string, Entry>();
  const now = options.now ?? Date.now;
  const requests = new Bucket(60, now);
  const uploads = new Bucket(6, now);
  const cancellations = new Bucket(12, now);
  const timeoutMs = options.timeoutMs ?? 120000;
  let activeJobs = 0;
  let activeUploads = 0;
  let stopped = false;

  function response(outcome: Outcome, origin: string | null) {
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    });
    if (origin && origins.has(origin))
      headers.set("Access-Control-Allow-Origin", origin);
    return Response.json(outcome.body, { status: outcome.status, headers });
  }
  function prune() {
    for (const [id, entry] of entries) {
      if (!entry.controller && entry.expires <= now()) {
        clearTimeout(entry.expiryTimer);
        entries.delete(id);
      }
    }
  }
  function capacity() {
    prune();
    if (entries.size >= (options.cacheSize ?? 128))
      throw new SpeechFault("busy");
  }
  function completed(fingerprint: string | undefined, outcome: Outcome): Entry {
    return {
      fingerprint,
      promise: Promise.resolve(outcome),
      expires: now() + CACHE_TTL,
      providerMayHaveProcessed:
        "error" in outcome.body && outcome.body.error.providerMayHaveProcessed,
    };
  }
  function remember(id: string, entry: Entry) {
    if (stopped) return;
    entries.set(id, entry);
    if (entry.controller) return;
    // Expiry removes transcripts even when the service receives no more traffic.
    entry.expiryTimer = setTimeout(() => {
      if (entries.get(id) === entry && !entry.controller) entries.delete(id);
    }, CACHE_TTL);
    entry.expiryTimer.unref();
  }
  function cancel(entry: Entry, code: "cancelled" | "timeout" = "cancelled") {
    entry.controller?.abort(
      new SpeechFault(code, entry.providerMayHaveProcessed),
    );
  }
  async function wait(entry: Entry, signal: AbortSignal) {
    const abort = () => {
      cancel(
        entry,
        signal.reason instanceof SpeechFault && signal.reason.code === "timeout"
          ? "timeout"
          : "cancelled",
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      throwIfAborted(signal);
      return await entry.promise;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  function start(
    id: string,
    fingerprint: string,
    audio: Uint8Array<ArrayBuffer>,
    metadata: z.infer<typeof TranscriptionRequest>,
  ) {
    const controller = new AbortController();
    const entry: Entry = {
      fingerprint,
      expires: Number.POSITIVE_INFINITY,
      controller,
      providerMayHaveProcessed: false,
      promise: Promise.resolve(failure(new SpeechFault("internal_error"))),
    };
    entries.set(id, entry);
    activeJobs++;
    const timer = setTimeout(() => cancel(entry, "timeout"), timeoutMs);
    // Race cancellation so even an uncooperative injected implementation cannot
    // hold a client open forever. Production guard/provider also abort their work.
    const aborted = new Promise<Outcome>((resolve) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          const reason = controller.signal.reason;
          resolve(
            failure(
              reason instanceof SpeechFault
                ? reason
                : new SpeechFault("cancelled", entry.providerMayHaveProcessed),
            ),
          );
        },
        { once: true },
      );
    });
    const work = (async (): Promise<Outcome> => {
      try {
        const acoustic = await options.guard(
          audio,
          metadata.mimeType,
          controller.signal,
        );
        throwIfAborted(controller.signal);
        if (
          !Number.isFinite(acoustic.durationSeconds) ||
          acoustic.durationSeconds <= 0 ||
          acoustic.durationSeconds > SPEECH_MAX_SECONDS
        ) {
          throw new SpeechFault("invalid_audio");
        }
        const transcript = acoustic.speechPresent
          ? await (() => {
              entry.providerMayHaveProcessed = true;
              return options.provider(audio, metadata, controller.signal);
            })()
          : { text: "", languages: [] };
        throwIfAborted(controller.signal);
        const result = TranscriptionResult.safeParse({
          id,
          provider: "openai",
          model: "gpt-transcribe",
          status: acoustic.speechPresent ? "transcribed" : "no_speech",
          ...transcript,
          durationSeconds: acoustic.durationSeconds,
        });
        if (!result.success)
          throw new SpeechFault(
            "provider_failed",
            entry.providerMayHaveProcessed,
          );
        return { status: 200, body: result.data };
      } catch (error) {
        return failure(
          error instanceof SpeechFault
            ? new SpeechFault(
                error.code,
                error.providerMayHaveProcessed ||
                  entry.providerMayHaveProcessed,
              )
            : new SpeechFault("internal_error", entry.providerMayHaveProcessed),
        );
      } finally {
        // Do not free the active-job slot until provider/process has actually stopped.
        activeJobs--;
        entry.controller = undefined;
        entry.expires = now() + CACHE_TTL;
        remember(id, entry);
      }
    })();
    entry.promise = Promise.race([work, aborted]).then((outcome) => {
      clearTimeout(timer);
      return outcome;
    });
    return entry;
  }

  async function transcribe(request: Request) {
    if (activeUploads >= 2) throw new SpeechFault("busy");
    if (!uploads.take()) throw new SpeechFault("rate_limited");
    const contentType = request.headers.get("content-type");
    if (
      !contentType ||
      !/^multipart\/form-data;\s*boundary=/i.test(contentType) ||
      contentType.length > 256
    ) {
      throw new SpeechFault("invalid_request");
    }
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES))
      throw new SpeechFault("audio_too_large");
    const controller = new AbortController();
    const disconnect = () => controller.abort(new SpeechFault("cancelled"));
    request.signal.addEventListener("abort", disconnect, { once: true });
    if (request.signal.aborted) disconnect();
    const timer = setTimeout(
      () => controller.abort(new SpeechFault("timeout")),
      timeoutMs,
    );
    activeUploads++;
    let uploading = true;
    try {
      const bytes = await readBounded(
        request.body,
        MAX_REQUEST_BYTES,
        controller.signal,
      );
      let form: FormData;
      try {
        form = await new Response(bytes, {
          headers: { "Content-Type": contentType },
        }).formData();
      } catch {
        throw new SpeechFault("invalid_request");
      }
      const fields = [...form.keys()];
      if (
        fields.length !== 2 ||
        !fields.includes("metadata") ||
        !fields.includes("audio")
      )
        throw new SpeechFault("invalid_request");
      const raw = form.get("metadata");
      const audioFile = form.get("audio");
      if (
        typeof raw !== "string" ||
        raw.length > 16384 ||
        !(audioFile instanceof File)
      )
        throw new SpeechFault("invalid_request");
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        throw new SpeechFault("invalid_request");
      }
      const parsed = TranscriptionRequest.safeParse(input);
      if (!parsed.success) {
        throw new SpeechFault(
          parsed.error.issues.some((issue) => issue.path[0] === "vocabulary")
            ? "vocabulary_budget"
            : "invalid_request",
        );
      }
      const metadata = parsed.data;
      const audio = new Uint8Array(await audioFile.arrayBuffer());
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(metadata))
        .update(audio)
        .digest("hex");
      activeUploads--;
      uploading = false;
      prune();
      const prior = entries.get(metadata.id);
      if (prior) {
        if (prior.fingerprint && prior.fingerprint !== fingerprint)
          throw new SpeechFault("id_conflict");
        return await wait(prior, controller.signal);
      }
      capacity();
      throwIfAborted(controller.signal);
      // Bun guesses MIME from filenames and can discard codec-parameter headers.
      // The schema allowlist and pinned acoustic demuxer verify the actual format;
      // neither an extension nor an untrusted multipart header proves its contents.
      if (audioFile.size > SPEECH_MAX_BYTES || audioFile.size === 0) {
        const entry = completed(
          fingerprint,
          failure(
            new SpeechFault(
              audioFile.size > SPEECH_MAX_BYTES
                ? "audio_too_large"
                : "invalid_audio",
            ),
          ),
        );
        remember(metadata.id, entry);
        return await entry.promise;
      }
      if (stopped || options.ready === false || activeJobs >= 2) {
        const entry = completed(
          fingerprint,
          failure(
            new SpeechFault(
              stopped || options.ready === false ? "unavailable" : "busy",
            ),
          ),
        );
        remember(metadata.id, entry);
        return await entry.promise;
      }
      return await wait(
        start(metadata.id, fingerprint, audio, metadata),
        controller.signal,
      );
    } finally {
      if (uploading) activeUploads--;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", disconnect);
    }
  }

  async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    try {
      if (origin !== null && !origins.has(origin))
        throw new SpeechFault("forbidden_origin");
      const path = new URL(request.url).pathname;
      const cancellation = path.startsWith(`${SPEECH_PATHS.transcriptions}/`)
        ? z.uuid().safeParse(path.slice(SPEECH_PATHS.transcriptions.length + 1))
        : undefined;
      const knownPath =
        path === SPEECH_PATHS.capabilities ||
        path === SPEECH_PATHS.transcriptions ||
        cancellation?.success;
      if (request.method === "OPTIONS") {
        // Browser preflight carries no bearer token; it authorizes only the exact
        // origin/method/header combination, never access to a protected operation.
        const method = request.headers.get("access-control-request-method");
        const expected =
          path === SPEECH_PATHS.capabilities
            ? "GET"
            : cancellation?.success
              ? "DELETE"
              : "POST";
        const headers = (
          request.headers.get("access-control-request-headers") ?? ""
        )
          .split(",")
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        if (
          !origin ||
          !knownPath ||
          method !== expected ||
          headers.some(
            (header) => !["authorization", "content-type"].includes(header),
          )
        )
          throw new SpeechFault("invalid_request");
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": expected,
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
            Vary: "Origin",
          },
        });
      }
      if (path === "/healthz" && request.method === "GET") {
        return new Response("ok", { headers: { "Cache-Control": "no-store" } });
      }
      const authorization = request.headers.get("authorization") ?? "";
      if (
        authorization.length > 512 ||
        !timingSafeEqual(
          tokenHash,
          createHash("sha256").update(authorization).digest(),
        )
      )
        throw new SpeechFault("unauthorized");
      if (!requests.take()) throw new SpeechFault("rate_limited");
      if (path === SPEECH_PATHS.capabilities && request.method === "GET") {
        return Response.json(
          SpeechCapabilities.parse({
            protocol: SPEECH_PROTOCOL,
            provider: "openai",
            model: "gpt-transcribe",
            ready: !stopped && options.ready !== false,
            maxBytes: SPEECH_MAX_BYTES,
            maxSeconds: SPEECH_MAX_SECONDS,
            maxTerms: SPEECH_MAX_TERMS,
            maxVocabularyCharacters: SPEECH_MAX_VOCABULARY_CHARACTERS,
            persistsAudio: false,
          }),
          {
            headers: {
              "Cache-Control": "no-store",
              Vary: "Origin",
              ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
            },
          },
        );
      }
      if (path === SPEECH_PATHS.transcriptions && request.method === "POST")
        return response(await transcribe(request), origin);
      if (cancellation?.success && request.method === "DELETE") {
        if (!cancellations.take()) throw new SpeechFault("rate_limited");
        prune();
        const entry = entries.get(cancellation.data);
        if (entry) cancel(entry);
        else {
          capacity();
          remember(
            cancellation.data,
            completed(undefined, failure(new SpeechFault("cancelled"))),
          );
        }
        return Response.json(
          SpeechCancellation.parse({ id: cancellation.data, cancelled: true }),
          {
            headers: {
              "Cache-Control": "no-store",
              Vary: "Origin",
              ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
            },
          },
        );
      }
      throw new SpeechFault("invalid_request");
    } catch (error) {
      return response(
        failure(
          error instanceof SpeechFault
            ? error
            : new SpeechFault("internal_error"),
        ),
        origin,
      );
    }
  }
  return {
    fetch: handle,
    close() {
      stopped = true;
      for (const entry of entries.values()) {
        cancel(entry);
        clearTimeout(entry.expiryTimer);
      }
      entries.clear();
    },
  };
}
