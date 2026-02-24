import { Hono } from "hono";
import { formatAndDiff } from "../services/format-diff";

export const reviewRouter = new Hono();

// POST /api/review/format-diff
reviewRouter.post("/format-diff", async (c) => {
  const body = (await c.req.json()) as {
    before: string;
    after: string;
    filePath: string;
    printWidth: number;
  };

  if (!body.filePath || typeof body.printWidth !== "number") {
    return c.json(
      { error: "Missing required fields: filePath, printWidth" },
      400,
    );
  }

  const result = await formatAndDiff({
    before: body.before ?? "",
    after: body.after ?? "",
    filePath: body.filePath,
    printWidth: body.printWidth,
  });

  return c.json(result);
});
