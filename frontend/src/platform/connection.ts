import { OpenCode } from "@opencode/client";
import { VoxPilotRpc } from "@plugin/rpc";
import { clearFileRoute } from "../features/files/file-links";
import {
  configuredServer,
  connectionConfig,
  requestedServerUrl,
} from "./connection-config";

export const serverUrl =
  configuredServer?.url ??
  (connectionConfig.servers.length === 0 && !connectionConfig.error
    ? (requestedServerUrl ?? localStorage.getItem("voxpilot:server"))
    : undefined) ??
  window.location.origin;
export const wakeStorageKey = `voxpilot:wakeUrl:${serverUrl}`;

export function makeClient(url: string, password: string) {
  const headers: Record<string, string> = {};
  if (password) {
    const bytes = new TextEncoder().encode(`opencode:${password}`);
    headers.authorization = `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))}`;
  }
  return OpenCode.make({
    baseUrl: url,
    headers,
    fetch: Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          credentials: password ? "omit" : "same-origin",
        }),
      { preconnect: fetch.preconnect },
    ),
  });
}

export const client = makeClient(
  serverUrl,
  configuredServer?.password ??
    (connectionConfig.servers.length === 0 && !connectionConfig.error
      ? sessionStorage.getItem(`voxpilot:password:${serverUrl}`)
      : undefined) ??
    "",
);

/** Local plugins activate asynchronously when a location is first requested. */
export async function waitForPlugin(remote = client) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const config = await remote
        .rpc(VoxPilotRpc)
        .config({}, { signal: AbortSignal.timeout(10_000) });
      if (config.protocol !== 1)
        throw new Error("This server needs a compatible VoxPilot plugin");
      return config;
    } catch (error) {
      if (
        Date.now() >= deadline ||
        !(error instanceof Error) ||
        !("type" in error) ||
        error.type !== "rpc.unavailable"
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export function changeServer() {
  const url = new URL(window.location.href);
  url.searchParams.set("connect", "1");
  window.location.href = url.href;
}

/** Validate the destination before replacing this document's single client. */
export async function switchConfiguredServer(id: string) {
  const server = connectionConfig.servers.find((entry) => entry.id === id);
  if (!server) throw new Error("Unknown configured server");
  if (server.id === configuredServer?.id) return;

  const remote = makeClient(server.url, server.password);
  await remote.server.info({ signal: AbortSignal.timeout(10_000) });
  await waitForPlugin(remote);

  localStorage.setItem("voxpilot:serverId", server.id);
  localStorage.removeItem("voxpilot:server");
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("voxpilot:password:")) sessionStorage.removeItem(key);
  }

  const url = new URL(window.location.href);
  clearFileRoute(url);
  url.searchParams.delete("connect");
  url.searchParams.set("server", server.url);
  url.searchParams.set("serverId", server.id);
  url.searchParams.set("open", "latest");
  url.hash = "";
  window.location.replace(url.href);
}
