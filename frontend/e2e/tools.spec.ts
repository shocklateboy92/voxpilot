import { randomUUID } from "node:crypto";
import type { SessionMessageAssistantTool } from "@opencode/client";
import { expect, idle, send, test } from "./browser";
import { assistant, history, openSession } from "./data";
import { client, markdownPrompt } from "./dev";

function tool(
  name: string,
  state: SessionMessageAssistantTool["state"],
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: `${name}-call`,
    name,
    state,
    time: { created: Date.now(), completed: Date.now() },
  };
}

test("specialized tool cards show paths, summaries, outputs, attachments, and errors", async ({
  app,
  workspace,
}) => {
  const entries: Array<{
    name: string;
    input: Extract<
      SessionMessageAssistantTool["state"],
      { status: "completed" }
    >["input"];
    summary: string;
  }> = [
    {
      name: "read",
      input: { path: `${workspace.directory}/read.ts`, offset: 2, limit: 3 },
      summary: "read.ts:2-4",
    },
    {
      name: "edit",
      input: { filePath: `${workspace.directory}/edit.ts` },
      summary: "edit.ts",
    },
    {
      name: "write",
      input: { filePath: `${workspace.directory}/write.ts` },
      summary: "write.ts",
    },
    {
      name: "glob",
      input: { pattern: "**/*.ts" },
      summary: "**/*.ts — 2 files",
    },
    {
      name: "grep",
      input: { pattern: "needle" },
      summary: "needle — 2 matches",
    },
    {
      name: "webfetch",
      input: { url: "https://example.invalid/page" },
      summary: "example.invalid",
    },
    {
      name: "subagent",
      input: { description: "Investigate result", agent: "explore" },
      summary: "Investigate result",
    },
    {
      name: "pty_spawn",
      input: { command: "echo", args: ["hello"] },
      summary: "echo hello",
    },
    {
      name: "shell",
      input: {
        command: "printf output",
        workdir: workspace.directory,
        description: "Shell description",
      },
      summary: "printf output",
    },
  ];
  const parts = entries.map((entry) =>
    tool(entry.name, {
      status: "completed",
      input: entry.input,
      content: [
        { type: "text", text: `${entry.name} output <script>unsafe</script>` },
      ],
      metadata: { count: 2, matches: 2 },
    }),
  );
  parts.push(
    tool("todowrite", {
      status: "completed",
      input: {
        todos: [
          { content: "Finished task", status: "completed" },
          { content: "Active task", status: "in_progress" },
        ],
      },
      content: [{ type: "text", text: "Tasks saved" }],
    }),
  );
  parts.push(
    tool("unknown_e2e_tool", {
      status: "error",
      input: { custom: "input value" },
      error: { type: "tool", message: "Expected tool failure" },
      content: [
        { type: "text", text: "Failure diagnostics" },
        {
          type: "file",
          uri: "file:///tmp/e2e.txt",
          mime: "text/plain",
          name: "diagnostics.txt",
        },
      ],
    }),
  );
  const session = await history(workspace.directory, "Tool cards", [
    assistant(parts),
  ]);
  await openSession(app, session.id);
  await expect(app.locator(".tool-block")).toHaveCount(parts.length);
  for (const entry of entries) {
    const card = app
      .locator(".tool-block")
      .filter({ has: app.locator("summary", { hasText: entry.summary }) });
    await expect(card).not.toHaveAttribute("open");
    await card.locator("summary").click();
    await expect(card).toContainText(
      `${entry.name} output <script>unsafe</script>`,
    );
    await expect(card.locator("script")).toHaveCount(0);
    await expect(
      card.getByRole("img", { name: "Tool completed" }),
    ).toBeVisible();
    await card.locator("summary").click();
    await expect(card).not.toHaveAttribute("open");
  }
  const todos = app.locator(".tool-block", { hasText: "Active task" });
  await todos.locator("summary").click();
  await expect(todos).toContainText("Finished task");
  const failed = app.locator(".tool-block", { hasText: "unknown_e2e_tool" });
  await failed.locator("summary").click();
  await expect(failed).toContainText("Expected tool failure");
  await expect(failed).toContainText("Failure diagnostics");
  await expect(failed).toContainText("diagnostics.txt (text/plain)");
  await expect(failed).toContainText("input value");
});

test("background shell and subagent states reflect durable completion/error messages without displaying internal notifications", async ({
  app,
  workspace,
}) => {
  const parts = [
    tool("shell", {
      status: "completed",
      input: { command: "background command" },
      metadata: { status: "running", shellID: "shell-e2e" },
      content: [{ type: "text", text: "Started" }],
    }),
    tool("subagent", {
      status: "completed",
      input: { description: "Background investigation" },
      metadata: { status: "running", sessionID: "child-e2e" },
      content: [{ type: "text", text: "Started" }],
    }),
  ];
  const session = await history(workspace.directory, "Background results", [
    assistant(parts),
    {
      id: "msg_background_shell",
      type: "synthetic",
      time: { created: Date.now() },
      text: "Internal shell notification",
      metadata: {
        source: "shell",
        shellID: "shell-e2e",
        state: "completed",
        exit: 0,
      },
    },
    {
      id: "msg_background_child",
      type: "synthetic",
      time: { created: Date.now() },
      text: "Internal child notification",
      metadata: { source: "subagent", childID: "child-e2e", state: "timeout" },
    },
  ]);
  await openSession(app, session.id);
  await expect(
    app
      .locator(".tool-block", { hasText: "background command" })
      .getByRole("img", { name: "Tool completed" }),
  ).toBeVisible();
  await expect(
    app
      .locator(".tool-block", { hasText: "Background investigation" })
      .getByRole("img", { name: "Tool error" }),
  ).toBeVisible();
  await expect(app.locator(".messages-content")).not.toContainText(
    "Internal shell notification",
  );
  await expect(app.locator(".messages-content")).not.toContainText(
    "Internal child notification",
  );
  await app.reload();
  await expect(app.getByRole("img", { name: "Tool error" })).toBeVisible();
});

test("real shell progress is visible before completion and a failing command exposes its diagnostics", async ({
  app,
  workspace,
}) => {
  const command = "printf LIVE_FIRST; sleep 5; printf LIVE_LAST; exit 7";
  const shell = await client.shell.create({
    command,
    cwd: workspace.directory,
    location: { directory: workspace.directory },
  });
  try {
    const session = await history(workspace.directory, "Live shell", [
      assistant([
        tool("shell", {
          status: "completed",
          input: { command },
          metadata: { status: "running", shellID: shell.data.id },
          content: [{ type: "text", text: "Started shell" }],
        }),
      ]),
    ]);
    await openSession(app, session.id);
    const card = app.locator(".tool-block");
    await expect(card.getByRole("img", { name: "Tool running" })).toBeVisible();
    await expect(card.locator("pre").last()).toHaveText("LIVE_FIRST");
    await expect(card.locator("pre").last()).toHaveText("LIVE_FIRSTLIVE_LAST");
    await expect
      .poll(
        async () =>
          (
            await client.shell.get({
              id: shell.data.id,
              location: { directory: workspace.directory },
            })
          ).data.status,
      )
      .toBe("exited");
    expect(
      (
        await client.shell.get({
          id: shell.data.id,
          location: { directory: workspace.directory },
        })
      ).data.exit,
    ).toBe(7);
  } finally {
    await client.shell.remove({
      id: shell.data.id,
      location: { directory: workspace.directory },
    });
  }
});

test("session metadata updates do not restart an in-flight shell output request", async ({
  app,
  workspace,
}) => {
  const toolID = `sh_${randomUUID()}`;
  let requests = 0;
  let releaseOutput = () => {};
  const outputReady = new Promise<void>((resolve) => {
    releaseOutput = resolve;
  });
  await app.route(`**/api/shell/${toolID}/output**`, async (route) => {
    requests += 1;
    // Keep the real missing-shell response in flight while metadata changes.
    await outputReady;
    await route.continue();
  });
  const session = await history(workspace.directory, "Shell request identity", [
    assistant([
      tool("shell", {
        status: "completed",
        input: { command: "missing shell during metadata updates" },
        metadata: { status: "running", shellID: toolID },
        content: [{ type: "text", text: "Saved output" }],
      }),
    ]),
  ]);
  try {
    await openSession(app, session.id);
    await expect.poll(() => requests).toBe(1);
    for (let index = 0; index < 3; index += 1) {
      const title = `Updated shell metadata ${index}`;
      await client.session.update({ sessionID: session.id, title });
      await expect(app.locator(".bottom-nav .session-title-btn")).toHaveText(
        title,
      );
    }
    releaseOutput();
    await expect(app.locator(".tool-block").getByRole("status")).toContainText(
      "Live output is unavailable on this server.",
    );
    expect(requests).toBe(1);
  } finally {
    releaseOutput();
  }
});

test("missing live shell tools stop polling and retain saved output", async ({
  app,
  workspace,
}) => {
  const toolID = `sh_${randomUUID()}`;
  let requests = 0;
  app.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith(`/shell/${toolID}/output`)) requests += 1;
  });
  const session = await history(
    workspace.directory,
    "Unavailable live shells",
    [
      assistant([
        tool("shell", {
          status: "completed",
          input: { command: "missing assistant command" },
          metadata: { status: "running", shellID: toolID },
          content: [{ type: "text", text: "Saved assistant output" }],
        }),
      ]),
    ],
  );
  await openSession(app, session.id);
  const toolCard = app.locator(".tool-block", {
    hasText: "missing assistant command",
  });
  await expect(toolCard.getByRole("status")).toHaveText(
    "Live output is unavailable on this server. Showing saved output.",
  );
  await expect(toolCard).toContainText("Saved assistant output");
  await app.clock.install();
  await app.clock.runFor(3500);
  await toolCard.locator("summary").click();
  await toolCard.locator("summary").click();
  await app.clock.runFor(3500);
  expect(requests).toBe(1);
});

test("user shell output missing on the connected server is not repeatedly retried", async ({
  app,
  workspace,
}) => {
  const session = await history(
    workspace.directory,
    "User shell wrong backend",
  );
  await openSession(app, session.id);
  const missingID = `sh_${randomUUID()}`;
  let requests = 0;
  await app.route("**/api/shell/*/output**", async (route) => {
    requests += 1;
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(
      /\/shell\/[^/]+\/output$/,
      `/shell/${missingID}/output`,
    );
    // Use the real server's missing-shell response to simulate the wrong runtime.
    const missing = await route.fetch({ url: url.href });
    await route.fulfill({ response: missing });
  });
  const command = "sleep 8 # unavailable user shell";
  const run = client.session.shell({ sessionID: session.id, command });
  try {
    const card = app.locator(".tool-block", { hasText: command });
    await expect(card.getByRole("status")).toContainText(
      "Live output is unavailable on this server.",
    );
    await app.clock.install();
    await app.clock.runFor(3500);
    await card.locator("summary").click();
    await card.locator("summary").click();
    await app.clock.runFor(3500);
    expect(requests).toBe(1);
  } finally {
    await run;
    const messages = await client.message.list({ sessionID: session.id });
    const shell = messages.data.find(
      (message) => message.type === "shell" && message.command === command,
    );
    if (shell?.type === "shell")
      await client.shell.remove({
        id: shell.shellID,
        location: { directory: workspace.directory },
      });
  }
});

test("user-run session shell commands show live progress before they exit", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "User shell progress");
  await openSession(app, session.id);
  const command =
    "printf USER_LIVE_FIRST; sleep 5; printf USER_LIVE_LAST; exit 7";
  const run = client.session.shell({ sessionID: session.id, command });
  try {
    const card = app.locator(".tool-block", { hasText: command });
    await expect(card.locator("summary")).toContainText("running");
    await expect(card.locator("pre")).toHaveText("USER_LIVE_FIRST");
    await expect(card.locator("pre")).toHaveText(
      "USER_LIVE_FIRSTUSER_LIVE_LAST",
    );
    await expect(card.locator("summary")).toContainText("exited");
  } finally {
    await run;
    const messages = await client.message.list({ sessionID: session.id });
    const shell = messages.data.find(
      (message) => message.type === "shell" && message.command === command,
    );
    if (shell?.type === "shell")
      await client.shell.remove({
        id: shell.shellID,
        location: { directory: workspace.directory },
      });
  }
});

test("failed native prompt requests show an error and leave the composer usable for recovery", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Prompt failure");
  await openSession(app, session.id);
  await app.route(
    "**/api/session/*/prompt",
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          _tag: "ServiceUnavailableError",
          message: "E2E temporary service failure",
        }),
      });
    },
    { times: 1 },
  );
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("This request intentionally fails.");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect(app.locator(".message.error")).toContainText("503");
  await expect(
    app.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await send(app, markdownPrompt);
  await expect(app.locator(".markdown-body").last()).toContainText(
    "Browser baseline passed.",
  );
  await idle(app);
  await expect(app.locator(".message.error")).toHaveCount(0);
});
