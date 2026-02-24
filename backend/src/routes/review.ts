import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Hono } from "hono";
import { formatAndDiff } from "../services/format-diff";

export function createReviewRouter(client: OpencodeClient) {
  const router = new Hono();

  // POST /api/review/format-diff
  router.post("/format-diff", async (c) => {
    const body = (await c.req.json()) as {
      sessionId: string;
      filePath: string;
      printWidth: number;
    };

    if (
      !body.sessionId ||
      !body.filePath ||
      typeof body.printWidth !== "number"
    ) {
      return c.json(
        { error: "Missing required fields: sessionId, filePath, printWidth" },
        400,
      );
    }

    const diffResult = await client.session.diff({
      sessionID: body.sessionId,
    });
    const fileDiff = (diffResult.data ?? []).find(
      (d) => d.file === body.filePath,
    );

    if (!fileDiff) {
      return c.json(
        { error: `File not found in session diff: ${body.filePath}` },
        404,
      );
    }

    const result = await formatAndDiff({
      before: fileDiff.before ?? "",
      after: fileDiff.after ?? "",
      filePath: body.filePath,
      printWidth: body.printWidth,
    });

    return c.json(result);
  });

  return router;
}
