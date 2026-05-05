/**
 * Runtime base path and backend selection.
 *
 * The frontend bundle is served by the gateway at two URL shapes:
 *   - `/`                       -> picker page (no backend selected)
 *   - `/backends/<name>/...`    -> the app, scoped to backend <name>
 *
 * Detection happens once, at module load, from `window.location.pathname`.
 * The chosen prefix is then used by `api-client.ts` and `rpc.ts` to build
 * the URLs they hit:
 *
 *   - OpenCode SDK base: `<origin><BACKEND_PREFIX>/oc`
 *   - Hono RPC base:     `<origin><BACKEND_PREFIX>/api`
 *
 * Switching backends is intentionally a full page navigation (`<a href>`,
 * not router `<A>`): the app's module-level singletons (SSE pump, store
 * init, navigation hash sync) are bound to one backend at boot. A page
 * load is the cheapest way to bind them to a different one without
 * threading a backend parameter through every call site.
 *
 * Standalone / dev mode: when neither `/` nor `/backends/...` matches
 * (e.g. running Vite directly at `:3000`), we treat that as standalone
 * mode -- BACKEND_PREFIX is empty, /api and /oc are reached at the root,
 * and there is no picker route. This preserves the today-style dev loop.
 */

const BACKEND_ROUTE = /^\/backends\/([^/]+)(\/.*)?$/;

function detect(): {
  prefix: string;
  name: string | null;
  pickerMode: boolean;
} {
  const path = window.location.pathname;
  const m = BACKEND_ROUTE.exec(path);
  if (m) {
    const name = m[1] ?? "";
    return { prefix: `/backends/${name}`, name, pickerMode: false };
  }
  // Vite dev: serves the SPA at "/" with backend proxied at /api and /oc.
  // The picker would just spin showing a 404 since there's no gateway. Stay
  // in standalone mode so today's `just dev` workflow keeps working.
  if (import.meta.env.DEV) {
    return { prefix: "", name: null, pickerMode: false };
  }
  // Production at the gateway root: picker page.
  if (path === "/" || path === "") {
    return { prefix: "", name: null, pickerMode: true };
  }
  // Anything else is standalone mode -- a single-host deployment with no
  // gateway. Use root paths and hide the picker. (Today this branch is
  // unreachable in prod since the gateway only serves /, /backends/, and
  // /assets/; included for forward compatibility with embedded deployments.)
  return { prefix: "", name: null, pickerMode: false };
}

const { prefix, name, pickerMode } = detect();

/** Path prefix to prepend to /api and /oc URLs. Empty in standalone mode. */
export const BACKEND_PREFIX = prefix;

/** Selected backend name (null when in picker or standalone mode). */
export const BACKEND_NAME = name;

/**
 * True when the URL is exactly "/" and the gateway is expected -- the app
 * should render the picker UI instead of booting the chat app.
 */
export const PICKER_MODE = pickerMode;

/**
 * Build a localStorage key that's automatically scoped to the current
 * backend, so the same browser can hold separate state per backend
 * without collisions. In standalone mode (no backend name) the key is
 * unscoped, preserving today's behavior.
 *
 * Example: `backendStorageKey("wakeUrl")` => `"voxpilot:devbox:wakeUrl"`
 * (or just `"voxpilot:wakeUrl"` in standalone mode).
 */
export function backendStorageKey(suffix: string): string {
  return name ? `voxpilot:${name}:${suffix}` : `voxpilot:${suffix}`;
}
