export function normalizeServerUrl(value: string) {
  const target = new URL(value);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error("Invalid server URL");
  return target.href.replace(/\/$/, "");
}

function parseConfig(data: unknown) {
  if (
    !data ||
    typeof data !== "object" ||
    !("servers" in data) ||
    !Array.isArray(data.servers)
  )
    throw new Error("Invalid config.json");
  const servers = data.servers.map((server: unknown) => {
    if (
      !server ||
      typeof server !== "object" ||
      !("id" in server) ||
      typeof server.id !== "string" ||
      !server.id.trim() ||
      !("name" in server) ||
      typeof server.name !== "string" ||
      !server.name.trim() ||
      !("url" in server) ||
      typeof server.url !== "string" ||
      !("password" in server) ||
      typeof server.password !== "string"
    )
      throw new Error("Invalid server entry");
    return {
      id: server.id,
      name: server.name,
      url: normalizeServerUrl(server.url),
      password: server.password,
    };
  });
  if (
    !servers.length ||
    new Set(servers.map((server) => server.id)).size !== servers.length
  )
    throw new Error("Server list must be nonempty with unique IDs");
  return servers;
}

function configError(detail: string) {
  return {
    servers: [],
    error: `Could not load the server configuration. ${detail}`,
  };
}

async function loadConfig() {
  try {
    const response = await fetch(new URL("config.json", document.baseURI), {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { servers: [], error: undefined };
    if (!response.ok)
      return configError(
        `config.json returned HTTP ${response.status}. Check site access, then reload.`,
      );
    const data: unknown = JSON.parse(await response.text());
    return { servers: parseConfig(data), error: undefined };
  } catch {
    return configError(
      "Check config.json's format, network connectivity and site access, then reload.",
    );
  }
}

export const connectionConfig = await loadConfig();
export const configuredServer = connectionConfig.servers.find(
  (server) => server.id === localStorage.getItem("voxpilot:serverId"),
);
