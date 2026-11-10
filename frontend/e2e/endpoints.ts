/** Fixed base ports remain overridable; worker replacements get fresh origins. */
export const workerIndex = Number(process.env.TEST_WORKER_INDEX ?? "0");

export function workerOrigin(base: string, index: number) {
  const url = new URL(base);
  if (
    url.protocol !== "http:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("E2E worker endpoints must be HTTP origins");
  const port = Number(url.port || "80") + index;
  if (!Number.isInteger(index) || index < 0 || port < 1 || port > 65_535)
    throw new Error("Invalid E2E worker port range");
  url.port = String(port);
  return url.origin;
}

export const apiURL = workerOrigin(
  process.env.VOXPILOT_E2E_API ?? "http://127.0.0.1:18001",
  workerIndex,
);
export const frontendURL = workerOrigin(
  process.env.VOXPILOT_E2E_URL ?? "http://localhost:13000",
  workerIndex,
);
