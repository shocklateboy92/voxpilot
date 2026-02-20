/**
 * API client functions.
 *
 * All endpoints use openapi-fetch for type-safe requests
 * derived from the generated OpenAPI spec.
 */

import createClient from "openapi-fetch";
import type { paths } from "./api";
import type { SessionSummary, GitHubUser, ArtifactDetail, ReviewCommentData } from "./store";

// ── Typed client ─────────────────────────────────────────────────────────────

const client = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
});

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<GitHubUser | null> {
  const { data, error } = await client.GET("/api/auth/me");
  if (error) return null;
  return data ?? null;
}

export async function logout(): Promise<void> {
  await client.POST("/api/auth/logout");
  window.location.reload();
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<SessionSummary[]> {
  const { data } = await client.GET("/api/sessions");
  return data ?? [];
}

export async function createSession(): Promise<SessionSummary> {
  const { data, error } = await client.POST("/api/sessions");
  if (error || !data) {
    const detail = error && "detail" in error
      ? JSON.stringify(error.detail)
      : "unknown error";
    throw new Error(`Failed to create session: ${detail}`);
  }
  return data;
}

export async function deleteSession(id: string): Promise<void> {
  await client.DELETE("/api/sessions/{session_id}", {
    params: { path: { session_id: id } },
  });
}

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * Post a user message to an active session stream.
 *
 * Uses plain fetch because openapi-fetch doesn't return the raw Response
 * object, and the caller needs the status code for 202/409 handling.
 */
export async function postMessage(
  sessionId: string,
  content: string,
  model = "gpt-4o",
): Promise<Response> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ content, model }),
  });

  if (response.status === 401) {
    window.location.reload();
  }

  return response;
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export async function fetchArtifact(artifactId: string): Promise<ArtifactDetail | null> {
  const response = await fetch(`/api/artifacts/${artifactId}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as ArtifactDetail;
}

export async function fetchFileFullText(
  artifactId: string,
  fileId: string,
): Promise<{ content: string; lineCount: number } | null> {
  const response = await fetch(
    `/api/artifacts/${artifactId}/files/${fileId}/full-text`,
    { credentials: "include" },
  );
  if (!response.ok) return null;
  return (await response.json()) as { content: string; lineCount: number };
}

export async function patchFileViewed(
  artifactId: string,
  fileId: string,
  viewed: boolean,
): Promise<void> {
  await fetch(`/api/artifacts/${artifactId}/files/${fileId}/viewed`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ viewed }),
  });
}

export async function postFileComment(
  artifactId: string,
  fileId: string,
  content: string,
  lineId?: string | null,
  lineNumber?: number | null,
): Promise<ReviewCommentData | null> {
  const response = await fetch(
    `/api/artifacts/${artifactId}/files/${fileId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content, line_id: lineId, line_number: lineNumber }),
    },
  );
  if (!response.ok) return null;
  return (await response.json()) as ReviewCommentData;
}

export async function deleteArtifactComment(
  artifactId: string,
  commentId: string,
): Promise<void> {
  await fetch(`/api/artifacts/${artifactId}/comments/${commentId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function submitReview(
  artifactId: string,
): Promise<{ status: string } | null> {
  const response = await fetch(`/api/artifacts/${artifactId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as { status: string };
}
