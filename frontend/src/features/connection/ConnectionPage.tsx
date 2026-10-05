import { createSignal, Show } from "solid-js";
import {
  makeClient,
  serverUrl,
  waitForPlugin,
} from "../../platform/connection";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { TextInput } from "../../ui/TextInput";

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
    <main class="h-full overflow-y-auto p-6">
      <h1 class="mb-4 text-[2rem] font-bold tracking-tight">VoxPilot</h1>
      <p class="my-4 text-muted">
        Connect to an OpenCode server with the VoxPilot plugin.
      </p>
      <form class="flex flex-col gap-3" onSubmit={connect}>
        <FormField label="Server URL">
          {(attributes) => (
            <TextInput
              {...attributes}
              name="server"
              type="url"
              required
              value={url()}
              onInput={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://opencode.example.com"
            />
          )}
        </FormField>
        <FormField label="Server password">
          {(attributes) => (
            <TextInput
              {...attributes}
              name="password"
              type="password"
              autocomplete="current-password"
            />
          )}
        </FormField>
        <p class="my-4 text-muted">
          Leave the password blank for a paired same-origin server. A password
          is kept only for this tab’s session.
        </p>
        <Button type="submit" disabled={busy()}>
          {busy() ? "Connecting…" : "Connect"}
        </Button>
      </form>
      <Show when={wakeUrl()}>
        <Button variant="ghost" onClick={wake}>
          {wakeSent() ? "Wake request sent" : "Wake host"}
        </Button>
      </Show>
    </main>
  );
}
