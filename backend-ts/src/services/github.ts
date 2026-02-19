import { randomBytes } from "node:crypto";
import type { GitHubUser } from "../schemas/api";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildAuthorizationUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, state });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${String(res.status)}`);
  }

  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("access_token" in data) ||
    typeof (data as Record<string, unknown>)["access_token"] !== "string"
  ) {
    throw new Error("GitHub token exchange response missing access_token");
  }
  return (data as Record<string, string>)["access_token"];
}

export async function getGithubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${String(res.status)}`);
  }

  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("login" in data) ||
    typeof (data as Record<string, unknown>)["login"] !== "string"
  ) {
    throw new Error("Invalid GitHub user response");
  }

  const obj = data as Record<string, unknown>;
  return {
    login: obj["login"] as string,
    name: typeof obj["name"] === "string" ? obj["name"] : null,
    avatar_url: typeof obj["avatar_url"] === "string" ? obj["avatar_url"] : "",
  };
}
