import { createSignal, Show } from "solid-js";
import { makeClient, serverUrl, waitForPlugin } from "../connection";

export function ConnectionPage() {
  const [url, setUrl] = createSignal(serverUrl);
  const [busy, setBusy] = createSignal(false);
  const [wakeSent, setWakeSent] = createSignal(false);
  const wakeUrl = () =>
    localStorage.getItem(`voxpilot:wakeUrl:${url().replace(/\/$/, "")}`);

  async function wake() {
    const target = wakeUrl();
    if (!target) return;
    await fetch(target, { method: "POST", mode: "no-cors" });
    setWakeSent(true);
  }

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement))
      throw new Error("Connection form is unavailable");
    const data = new FormData(form);
    const submittedUrl = data.get("server");
    const submittedPassword = data.get("password");
    if (
      typeof submittedUrl !== "string" ||
      typeof submittedPassword !== "string"
    )
      throw new Error("Connection form is incomplete");
    const target = new URL(submittedUrl);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      throw new Error(
        "Enter an HTTP(S) OpenCode server URL without credentials or query parameters.",
      );
    }
    const normalized = target.href.replace(/\/$/, "");
    setBusy(true);
    try {
      const remote = makeClient(normalized, submittedPassword);
      await remote.server.info({ signal: AbortSignal.timeout(10_000) });
      await waitForPlugin(remote);
      localStorage.setItem("voxpilot:server", normalized);
      sessionStorage.setItem(
        `voxpilot:password:${normalized}`,
        submittedPassword,
      );
      const page = new URL(window.location.href);
      page.searchParams.delete("connect");
      page.hash = "";
      window.location.replace(page.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="connection-page">
      <h1>VoxPilot</h1>
      <p>Connect to an OpenCode server with the VoxPilot plugin.</p>
      <form onSubmit={connect}>
        <label>
          Server URL
          <input
            name="server"
            type="url"
            required
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            placeholder="https://opencode.example.com"
          />
        </label>
        <label>
          Server password
          <input
            name="password"
            type="password"
            autocomplete="current-password"
          />
        </label>
        <p>
          Leave the password blank for a paired same-origin server. A password
          is kept only for this tab’s session.
        </p>
        <button type="submit" class="btn" disabled={busy()}>
          {busy() ? "Connecting…" : "Connect"}
        </button>
      </form>
      <Show when={wakeUrl()}>
        <button type="button" class="btn btn-ghost" onClick={wake}>
          {wakeSent() ? "Wake request sent" : "Wake host"}
        </button>
      </Show>
    </main>
  );
}
