/**
 * API client functions using Hono RPC.
 *
 * Uses `hc()` from hono/client for type-safe requests
 * derived from the backend's AppType.
 */

import type { AppType } from "@backend/index";
import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";
import type {
  SessionSummary,
  GitHubUser,
  ArtifactDetail,
  ReviewCommentData,
} from "./store";

// ── Typed RPC client ─────────────────────────────────────────────────────────

const rpc = hc<AppType>(window.location.origin, {
  init: { credentials: "include" },
});

// ── Error type ───────────────────────────────────────────────────────────────

/** Error thrown when an API request returns a non-success status code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status}: ${body || statusText}`);
    this.name = "ApiError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the JSON body type from the success-status variants of a Hono
 * ClientResponse union (one variant per status code).
 */
type SuccessOf<T extends ClientResponse<unknown>> =
  T extends ClientResponse<infer D, SuccessStatusCode, "json"> ? D : never;

/**
 * Awaits a response, throws ApiError on non-OK responses (including 401).
 * T is inferred from the success variant of the Hono ClientResponse union.
 */
async function authedJson<T extends ClientResponse<unknown>>(
  req: Promise<T>,
): Promise<SuccessOf<T>> {
  const res = await req;
  if (res.status === 401) {
    throw new ApiError(401, res.statusText, "Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, res.statusText, body);
  }
  // res.json() returns unknown when T is a union of ClientResponses (its format
  // parameter isn't narrowed here).  The cast is safe: we've verified ok===true
  // above, so only the success variant of the union is reachable.
  return res.json() as SuccessOf<T>;
}

/** Awaits a response, throws ApiError on non-OK responses (including 401). */
async function authedVoid(req: Promise<Response>): Promise<void> {
  const res = await req;
  if (res.status === 401) {
    throw new ApiError(401, res.statusText, "Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, res.statusText, body);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<GitHubUser | null> {
  try {
    return await authedJson(rpc.api.auth.me.$get());
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await authedVoid(rpc.api.auth.logout.$post());
  window.location.reload();
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<SessionSummary[]> {
  return authedJson(rpc.api.sessions.$get());
}

export async function createSession(): Promise<SessionSummary> {
  return authedJson(rpc.api.sessions.$post());
}

export function deleteSession(id: string): Promise<void> {
  return authedVoid(
    rpc.api.sessions[":session_id"].$delete({ param: { session_id: id } }),
  );
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export async function fetchArtifact(
  artifactId: string,
): Promise<ArtifactDetail> {
  return authedJson(
    rpc.api.artifacts[":id"].$get({ param: { id: artifactId } }),
  );
}

export async function fetchFileFullText(
  artifactId: string,
  fileId: string,
): Promise<{ content: string; lineCount: number }> {
  return authedJson(
    rpc.api.artifacts[":id"].files[":fileId"]["full-text"].$get({
      param: { id: artifactId, fileId },
    }),
  );
}

export function patchFileViewed(
  artifactId: string,
  fileId: string,
  viewed: boolean,
): Promise<void> {
  return authedVoid(
    rpc.api.artifacts[":id"].files[":fileId"].viewed.$patch({
      param: { id: artifactId, fileId },
      json: { viewed },
    }),
  );
}

export async function postFileComment(
  artifactId: string,
  fileId: string,
  content: string,
  lineId?: string | null,
  lineNumber?: number | null,
): Promise<ReviewCommentData> {
  return authedJson(
    rpc.api.artifacts[":id"].files[":fileId"].comments.$post({
      param: { id: artifactId, fileId },
      json: { content, line_id: lineId, line_number: lineNumber },
    }),
  );
}

export function deleteArtifactComment(
  artifactId: string,
  commentId: string,
): Promise<void> {
  return authedVoid(
    rpc.api.artifacts[":id"].comments[":commentId"].$delete({
      param: { id: artifactId, commentId },
    }),
  );
}

export async function submitReview(
  artifactId: string,
): Promise<{ status: string }> {
  return authedJson(
    rpc.api.artifacts[":id"].submit.$post({
      param: { id: artifactId },
    }),
  );
}
