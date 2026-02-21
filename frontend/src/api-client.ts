/**
 * API client functions using Hono RPC.
 *
 * Uses `hc()` from hono/client for type-safe requests
 * derived from the backend's AppType.
 */

import type { AppType } from "@backend/index";
import { hc } from "hono/client";
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Awaits a response, reloads on 401, returns parsed JSON or null on error. */
async function authedJson<T>(req: Promise<Response>): Promise<T | null> {
  const res = await req;
  if (res.status === 401) {
    window.location.reload();
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Awaits a response, reloads on 401. Ignores body. */
async function authedVoid(req: Promise<Response>): Promise<void> {
  const res = await req;
  if (res.status === 401) {
    window.location.reload();
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<GitHubUser | null> {
  return authedJson<GitHubUser>(rpc.api.auth.me.$get());
}

export async function logout(): Promise<void> {
  await authedVoid(rpc.api.auth.logout.$post());
  window.location.reload();
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<SessionSummary[]> {
  const data = await authedJson<SessionSummary[]>(rpc.api.sessions.$get());
  return data ?? [];
}

export async function createSession(): Promise<SessionSummary> {
  const res = await rpc.api.sessions.$post();
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create session: ${text}`);
  }
  return (await res.json()) as SessionSummary;
}

export async function deleteSession(id: string): Promise<void> {
  await authedVoid(
    rpc.api.sessions[":session_id"].$delete({ param: { session_id: id } }),
  );
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export async function fetchArtifact(
  artifactId: string,
): Promise<ArtifactDetail | null> {
  return authedJson<ArtifactDetail>(
    rpc.api.artifacts[":id"].$get({ param: { id: artifactId } }),
  );
}

export async function fetchFileFullText(
  artifactId: string,
  fileId: string,
): Promise<{ content: string; lineCount: number } | null> {
  return authedJson<{ content: string; lineCount: number }>(
    rpc.api.artifacts[":id"].files[":fileId"]["full-text"].$get({
      param: { id: artifactId, fileId },
    }),
  );
}

export async function patchFileViewed(
  artifactId: string,
  fileId: string,
  viewed: boolean,
): Promise<void> {
  await authedVoid(
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
): Promise<ReviewCommentData | null> {
  return authedJson<ReviewCommentData>(
    rpc.api.artifacts[":id"].files[":fileId"].comments.$post({
      param: { id: artifactId, fileId },
      json: { content, line_id: lineId, line_number: lineNumber },
    }),
  );
}

export async function deleteArtifactComment(
  artifactId: string,
  commentId: string,
): Promise<void> {
  await authedVoid(
    rpc.api.artifacts[":id"].comments[":commentId"].$delete({
      param: { id: artifactId, commentId },
    }),
  );
}

export async function submitReview(
  artifactId: string,
): Promise<{ status: string } | null> {
  return authedJson<{ status: string }>(
    rpc.api.artifacts[":id"].submit.$post({
      param: { id: artifactId },
    }),
  );
}
