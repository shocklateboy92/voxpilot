import { OpenCode } from "@opencode/client";
import { VoxPilotRpc } from "@plugin/rpc";

export const serverUrl =
  localStorage.getItem("voxpilot:server") ?? window.location.origin;
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
  sessionStorage.getItem(`voxpilot:password:${serverUrl}`) ?? "",
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
