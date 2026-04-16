import type { Context } from "hono";

export function proxy(target: string, stripPrefix?: string) {
  return async (c: Context) => {
    const url = new URL(c.req.url);
    let path = url.pathname;
    if (stripPrefix && path.startsWith(stripPrefix)) {
      path = path.slice(stripPrefix.length) || "/";
    }
    const proxiedUrl = `${target}${path}${url.search}`;
    const resp = await fetch(proxiedUrl, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== "GET" ? c.req.raw.body : undefined,
      // @ts-expect-error duplex required for streaming bodies
      duplex: "half",
    });

    // Bun's fetch auto-decompresses the response body, but the upstream
    // headers still advertise Content-Encoding: gzip. Forwarding those
    // headers causes the browser to try to decompress already-plain data.
    // Strip the hop-by-hop encoding headers so the response is consistent.
    const headers = new Headers(resp.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");

    return new Response(resp.body, {
      status: resp.status,
      headers,
    });
  };
}
