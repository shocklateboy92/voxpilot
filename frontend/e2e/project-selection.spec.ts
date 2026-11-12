import { expect, frontendTest as test } from "./fixtures";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
});

test("only the non-Git VoxPilot installation project is hidden", async ({
  page,
}) => {
  await page.route("**/project-selection-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<div></div>" }),
  );
  await page.goto("/project-selection-fixture");
  const selectable = await page.evaluate(async () => {
    const moduleURL = "/src/features/chat/project-selection.ts";
    const {
      isSelectableProject,
    }: typeof import("../src/features/chat/project-selection") = await import(
      moduleURL
    );
    return [
      { canonical: "/home/fernie/.local/share/voxpilot" },
      { canonical: "/home/another-user/.local/share/voxpilot/" },
      { canonical: "/home/fernie/src/voxpilot", vcs: "git" },
      { canonical: "/home/fernie/src/voxpilot" },
      { canonical: "/home/fernie/src/theatre-os", vcs: "git" },
      { canonical: "/home/fernie/.local/share/voxpilot", vcs: "git" },
      { canonical: "/home/fernie/.local/share/voxpilot-backup" },
      { canonical: "/home/fernie/.local/share/voxpilot/examples" },
    ].map(isSelectableProject);
  });
  expect(selectable).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
});
