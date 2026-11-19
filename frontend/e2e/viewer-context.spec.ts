import { expect, test } from "@playwright/test";
import { formatViewerContext } from "../src/platform/prompt-files";

test("viewer context names the selected file once when it is still open", () => {
  const viewer = { filePath: "/repo/notes.md", workspace: "/repo" };
  expect(
    formatViewerContext(viewer, {
      viewer: { ...viewer },
      text: 'call("one");\n  call("two");',
    }),
  ).toBe(
    'User was viewing: /repo/notes.md\nWorkspace: /repo\n\nSelected text:\n  call("one");\n    call("two");',
  );
  expect(formatViewerContext(viewer, undefined)).toBe(
    "User was viewing: /repo/notes.md\nWorkspace: /repo",
  );
});

test("viewer context distinguishes a selection from another snapshot", () => {
  const result = formatViewerContext(
    { filePath: "src/example.ts", snapshotId: "current" },
    {
      viewer: { filePath: "src/example.ts", snapshotId: "earlier" },
      side: "before",
      text: "removed();",
    },
  );
  expect(result).toBe(
    "User was viewing: src/example.ts\nSnapshot: current\n\nSelected from: src/example.ts\nSnapshot: earlier\n\nSelected text (before):\n  removed();",
  );
});
