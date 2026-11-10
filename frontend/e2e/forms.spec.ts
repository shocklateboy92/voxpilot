import { expect, test } from "./browser";
import { history, openSession } from "./data";
import { client } from "./dev";

test("idle forms survive project refreshes and reload without dropping pending questions", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Idle form recovery");
  await openSession(app, session.id);
  const form = await client.session.form.create({
    sessionID: session.id,
    title: "Idle question",
    fields: [
      { key: "answer", title: "Answer", type: "string", required: true },
    ],
  });
  expect((await client.session.active())[session.id]).toBeUndefined();
  const answer = app.locator(".question-block").getByLabel("Answer", {
    exact: true,
  });
  await answer.fill("Keep this draft");

  await client.project.update({
    projectID: workspace.projectID,
    name: "Refreshed form project",
  });
  // The renamed badge proves the connection snapshot has reached the store.
  await app.locator(".bottom-nav .session-title-btn").click();
  const picker = app.getByRole("dialog", { name: "Sessions", exact: true });
  await expect(
    picker.getByText("Refreshed form project", { exact: true }),
  ).toBeVisible();
  await picker.getByRole("button", { name: "Close", exact: true }).click();
  await expect(answer).toHaveValue("Keep this draft");

  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(answer).toBeVisible();
  await answer.fill("Recovered after reload");
  await app
    .locator(".question-block")
    .getByRole("button", { name: "Submit", exact: true })
    .click();
  await expect(app.locator(".question-block")).toHaveCount(0);
  expect(
    (await client.session.form.get({ sessionID: session.id, formID: form.id }))
      .state,
  ).toEqual({
    status: "answered",
    answer: { answer: "Recovered after reload" },
  });
});

test("typed forms validate required and conditional fields and persist the exact answer", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Typed form");
  await openSession(app, session.id);
  const form = await client.session.form.create({
    sessionID: session.id,
    title: "E2E settings",
    fields: [
      {
        key: "kind",
        type: "string",
        title: "Kind",
        required: true,
        custom: true,
        options: [
          { label: "Advanced", value: "advanced" },
          { label: "Simple", value: "simple" },
        ],
      },
      {
        key: "features",
        type: "multiselect",
        title: "Features",
        required: true,
        custom: true,
        minItems: 2,
        maxItems: 3,
        options: [
          { label: "Alpha", value: "alpha" },
          { label: "Beta", value: "beta" },
        ],
      },
      {
        key: "count",
        type: "integer",
        title: "Count",
        required: true,
        minimum: 1,
        maximum: 5,
      },
      {
        key: "ratio",
        type: "number",
        title: "Ratio",
        required: true,
        minimum: 0,
        maximum: 1,
      },
      { key: "enabled", type: "boolean", title: "Enabled", required: true },
      {
        key: "detail",
        type: "string",
        title: "Advanced detail",
        required: true,
        when: [{ key: "kind", op: "eq", value: "advanced" }],
      },
      { key: "hidden", type: "string", hidden: true, default: "retained" },
    ],
  });
  const question = app.locator(".question-block");
  const submit = question.getByRole("button", { name: "Submit", exact: true });
  await expect(question).toContainText("E2E settings");
  await expect(submit).toBeDisabled();
  await expect(
    question.getByLabel("Advanced detail", { exact: true }),
  ).toHaveCount(0);
  await question.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(
    question.getByLabel("Advanced detail", { exact: true }),
  ).toBeVisible();
  await question.getByRole("button", { name: "Alpha", exact: true }).click();
  await question.getByLabel("Count", { exact: true }).fill("3");
  await question.getByLabel("Ratio", { exact: true }).fill("0.5");
  await question.getByLabel("Enabled", { exact: true }).selectOption("false");
  await question.getByLabel("Advanced detail", { exact: true }).fill("details");
  await expect(submit).toBeDisabled();
  await question.getByRole("button", { name: "Beta", exact: true }).click();
  await question
    .getByLabel("Custom answers for Features", { exact: true })
    .fill("custom");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(question).toHaveCount(0);
  expect(
    (await client.session.form.get({ sessionID: session.id, formID: form.id }))
      .state,
  ).toEqual({
    status: "answered",
    answer: {
      kind: "advanced",
      features: ["alpha", "beta", "custom"],
      count: 3,
      ratio: 0.5,
      enabled: false,
      detail: "details",
      hidden: "retained",
    },
  });
});

test("custom single answers and question rejection are persisted without AI generation", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Custom form");
  await openSession(app, session.id);
  const form = await client.session.form.create({
    sessionID: session.id,
    title: "Custom question",
    fields: [
      {
        key: "choice",
        type: "string",
        title: "Choice",
        required: true,
        custom: true,
        options: [{ label: "Alpha", value: "alpha" }],
      },
    ],
  });
  await app
    .locator(".question-block")
    .getByLabel("Choice", { exact: true })
    .fill("something else");
  await app
    .locator(".question-block")
    .getByRole("button", { name: "Submit", exact: true })
    .click();
  await expect(app.locator(".question-block")).toHaveCount(0);
  expect(
    (await client.session.form.get({ sessionID: session.id, formID: form.id }))
      .state,
  ).toEqual({ status: "answered", answer: { choice: "something else" } });
  const rejected = await client.session.form.create({
    sessionID: session.id,
    title: "Reject this question",
    fields: [{ key: "answer", type: "string", required: true }],
  });
  await app
    .locator(".question-block")
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await expect(app.locator(".question-block")).toHaveCount(0);
  expect(
    (
      await client.session.form.get({
        sessionID: session.id,
        formID: rejected.id,
      })
    ).state.status,
  ).toBe("cancelled");
});

test("conditional answers are excluded when inactive and numeric browser validation prevents an invalid submission", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Conditional validation");
  await openSession(app, session.id);
  const form = await client.session.form.create({
    sessionID: session.id,
    title: "Validation",
    fields: [
      {
        key: "advanced",
        title: "Advanced mode",
        type: "boolean",
        required: true,
      },
      {
        key: "detail",
        title: "Advanced detail",
        type: "string",
        required: true,
        when: [{ key: "advanced", op: "eq", value: true }],
      },
      {
        key: "count",
        title: "Count",
        type: "integer",
        required: true,
        minimum: 1,
        maximum: 3,
      },
    ],
  });
  const question = app.locator(".question-block");
  await question
    .getByLabel("Advanced mode", { exact: true })
    .selectOption("true");
  await question
    .getByLabel("Advanced detail", { exact: true })
    .fill("ignore this stale answer");
  await question
    .getByLabel("Advanced mode", { exact: true })
    .selectOption("false");
  await expect(
    question.getByLabel("Advanced detail", { exact: true }),
  ).toHaveCount(0);
  await question.getByLabel("Count", { exact: true }).fill("4");
  await question.getByRole("button", { name: "Submit", exact: true }).click();
  expect(
    (await client.session.form.get({ sessionID: session.id, formID: form.id }))
      .state.status,
  ).toBe("pending");
  await question.getByLabel("Count", { exact: true }).fill("2");
  await question.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await client.session.form.get({
            sessionID: session.id,
            formID: form.id,
          })
        ).state,
    )
    .toEqual({ status: "answered", answer: { advanced: false, count: 2 } });
});

for (const decision of ["Reject", "Always allow"]) {
  test(`permission ${decision} reaches the server and clears the pending request`, async ({
    app,
    workspace,
  }) => {
    const session = await history(
      workspace.directory,
      `Permission ${decision}`,
    );
    await client.session.update({
      sessionID: session.id,
      permissions: [{ action: "e2e-permission", resource: "*", effect: "ask" }],
    });
    await openSession(app, session.id);
    const pending = client.permission.create({
      sessionID: session.id,
      action: "e2e-permission",
      resources: [workspace.directory],
      save: [`${workspace.directory}/*`],
    });
    const outcome = pending.then((result) => result);
    await expect(app.locator(".tool-confirm")).toContainText(
      workspace.directory,
    );
    const reply = app.waitForRequest(
      (request) =>
        request.url().endsWith("/reply") && request.method() === "POST",
    );
    await app
      .locator(".tool-confirm")
      .getByRole("button", { name: decision, exact: true })
      .click();
    expect((await reply).postDataJSON()).toMatchObject({
      decision: decision === "Reject" ? "reject" : "always",
    });
    await expect(app.locator(".tool-confirm")).toHaveCount(0);
    // Create returns the evaluated effect before the user replies.
    expect((await outcome).effect).toBe("ask");
    expect(await client.permission.list({ sessionID: session.id })).toEqual([]);
    if (decision === "Always allow") {
      const saved = await client.permission.saved.list({
        projectID: workspace.projectID,
      });
      const own = saved.filter((rule) =>
        JSON.stringify(rule).includes(workspace.directory),
      );
      expect(own.length).toBeGreaterThan(0);
      for (const rule of own)
        await client.permission.saved.remove({ id: rule.id });
    }
  });
}
