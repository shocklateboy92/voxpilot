/**
 * Copilot device flow authentication and token management.
 *
 * Implements GitHub's device code flow to obtain a `gho_` token, exchanges
 * it for a Copilot API JWT, and manages refresh on a timer.
 *
 * Token persistence: $XDG_DATA_HOME/voxpilot/token.json
 * (falls back to ~/.local/share/voxpilot/token.json, overridable via config)
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { config } from "../config";
import type { GitHubUser } from "../schemas/api";

// ── GitHub API URLs ──────────────────────────────────────────────────────────

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

// ── Token file I/O ────────────────────────────────────────────────────────────

interface PersistedToken {
  gho_token: string;
  github_login: string;
  github_name: string | null;
  github_avatar_url: string;
}

function getTokenPath(): string {
  if (config.copilotDataDir) {
    return join(config.copilotDataDir, "token.json");
  }
  const xdgDataHome =
    process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(xdgDataHome, "voxpilot", "token.json");
}

export async function loadPersistedToken(): Promise<PersistedToken | null> {
  try {
    const raw = await readFile(getTokenPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("gho_token" in parsed) ||
      typeof (parsed as Record<string, unknown>)["gho_token"] !== "string"
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    return {
      gho_token: obj["gho_token"] as string,
      github_login:
        typeof obj["github_login"] === "string" ? obj["github_login"] : "",
      github_name:
        typeof obj["github_name"] === "string" ? obj["github_name"] : null,
      github_avatar_url:
        typeof obj["github_avatar_url"] === "string"
          ? obj["github_avatar_url"]
          : "",
    };
  } catch {
    return null;
  }
}

export async function persistToken(token: PersistedToken): Promise<void> {
  const path = getTokenPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(token, null, 2), "utf-8");
}

async function deleteTokenFile(): Promise<void> {
  try {
    await unlink(getTokenPath());
  } catch {
    // File may not exist; that's fine
  }
}

// ── Device flow ───────────────────────────────────────────────────────────────

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  if (!config.copilotClientId) {
    throw new Error(
      "VOXPILOT_COPILOT_CLIENT_ID is not set — cannot start device flow",
    );
  }
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.copilotClientId,
      scope: "user:email",
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub device code request failed: ${String(res.status)}`);
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid device code response");
  }
  const obj = data as Record<string, unknown>;
  return {
    device_code: String(obj["device_code"] ?? ""),
    user_code: String(obj["user_code"] ?? ""),
    verification_uri: String(obj["verification_uri"] ?? ""),
    interval: typeof obj["interval"] === "number" ? obj["interval"] : 5,
  };
}

export type PollResult =
  | { status: "success"; access_token: string }
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "error"; detail: string };

export async function pollDeviceFlow(
  deviceCode: string,
  currentInterval: number,
): Promise<PollResult> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.copilotClientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  if (!res.ok) {
    return {
      status: "error",
      detail: `GitHub token poll failed: ${String(res.status)}`,
    };
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) {
    return { status: "error", detail: "Invalid poll response" };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj["access_token"] === "string") {
    return { status: "success", access_token: obj["access_token"] };
  }

  const error = String(obj["error"] ?? "");
  if (error === "authorization_pending") return { status: "pending" };
  if (error === "slow_down") {
    return {
      status: "slow_down",
      interval:
        typeof obj["interval"] === "number" ? obj["interval"] : currentInterval + 5,
    };
  }
  if (error === "expired_token") return { status: "expired" };

  return {
    status: "error",
    detail: `Device flow error: ${error}`,
  };
}

// ── Copilot JWT exchange ──────────────────────────────────────────────────────

interface CopilotJwtResponse {
  token: string;
  endpoints: { api: string };
  expires_at: number;
  refresh_in: number;
}

export async function exchangeForCopilotJwt(
  ghoToken: string,
): Promise<CopilotJwtResponse> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `token ${ghoToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Copilot JWT exchange failed: ${String(res.status)}`);
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid Copilot JWT response");
  }

  const obj = data as Record<string, unknown>;
  const endpointsObj = obj["endpoints"];
  const apiUrl: string =
    typeof endpointsObj === "object" &&
    endpointsObj !== null &&
    "api" in endpointsObj &&
    typeof (endpointsObj as Record<string, unknown>)["api"] === "string"
      ? String((endpointsObj as Record<string, unknown>)["api"])
      : "https://api.githubcopilot.com";

  return {
    token: String(obj["token"] ?? ""),
    endpoints: { api: apiUrl },
    expires_at: typeof obj["expires_at"] === "number" ? obj["expires_at"] : 0,
    refresh_in:
      typeof obj["refresh_in"] === "number" ? obj["refresh_in"] : 1500,
  };
}

// ── GitHub user fetch ─────────────────────────────────────────────────────────

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

// ── CopilotTokenManager ───────────────────────────────────────────────────────

interface JwtState {
  jwt: string;
  baseUrl: string;
}

interface UserState {
  login: string;
  name: string | null;
  avatar_url: string;
}

export class CopilotTokenManager {
  private ghoToken: string | null = null;
  private jwtState: JwtState | null = null;
  private userState: UserState | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Load persisted token and exchange for JWT. Starts in unauthenticated state if no file. */
  async init(): Promise<void> {
    const persisted = await loadPersistedToken();
    if (!persisted) return;

    try {
      await this._setupFromGhoToken(persisted.gho_token, {
        login: persisted.github_login,
        name: persisted.github_name,
        avatar_url: persisted.github_avatar_url,
      });
    } catch (err) {
      console.error("Failed to initialize Copilot token on startup:", err);
    }
  }

  /** Returns JWT + base URL for the Copilot API, or throws if not authenticated. */
  getJwt(): JwtState {
    if (!this.jwtState) {
      throw new Error("Not authenticated — no Copilot JWT available");
    }
    return this.jwtState;
  }

  /** Whether the manager currently holds a valid token. */
  isAuthenticated(): boolean {
    return this.jwtState !== null;
  }

  /** Returns cached GitHub user info, or null if not authenticated. */
  getUser(): UserState | null {
    return this.userState;
  }

  /** Authenticate with a `gho_` token: persist, fetch user, exchange JWT. */
  async authenticate(ghoToken: string): Promise<void> {
    const user = await getGithubUser(ghoToken);
    await persistToken({
      gho_token: ghoToken,
      github_login: user.login,
      github_name: user.name ?? null,
      github_avatar_url: user.avatar_url,
    });
    await this._setupFromGhoToken(ghoToken, {
      login: user.login,
      name: user.name ?? null,
      avatar_url: user.avatar_url,
    });
  }

  /** Clear auth state and delete the persisted token file. */
  async logout(): Promise<void> {
    this._clearRefreshTimer();
    this.ghoToken = null;
    this.jwtState = null;
    this.userState = null;
    await deleteTokenFile();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _setupFromGhoToken(
    ghoToken: string,
    user: UserState,
  ): Promise<void> {
    const jwtResp = await exchangeForCopilotJwt(ghoToken);
    this.ghoToken = ghoToken;
    this.jwtState = { jwt: jwtResp.token, baseUrl: jwtResp.endpoints.api };
    this.userState = user;
    this._scheduleRefresh(jwtResp.refresh_in);
  }

  private _scheduleRefresh(refreshIn: number): void {
    this._clearRefreshTimer();
    const delayMs = Math.max(refreshIn * 1000 - 10_000, 5_000);
    this.refreshTimer = setTimeout(() => {
      this._refresh().catch((err) => {
        console.error("Copilot JWT refresh failed:", err);
      });
    }, delayMs);
  }

  private async _refresh(): Promise<void> {
    if (!this.ghoToken) return;
    try {
      const jwtResp = await exchangeForCopilotJwt(this.ghoToken);
      this.jwtState = {
        jwt: jwtResp.token,
        baseUrl: jwtResp.endpoints.api,
      };
      this._scheduleRefresh(jwtResp.refresh_in);
    } catch (err) {
      console.error("Copilot JWT refresh error:", err);
    }
  }

  private _clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

/** Global singleton token manager. */
export const tokenManager = new CopilotTokenManager();
