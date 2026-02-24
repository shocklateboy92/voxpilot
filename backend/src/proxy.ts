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
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  };
}
