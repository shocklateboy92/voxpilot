import { describe, expect, it } from "bun:test";
import { toScreamingSnake } from "../src/config";

describe("toScreamingSnake", () => {
  it("converts simple camelCase", () => {
    expect(toScreamingSnake("appName")).toBe("APP_NAME");
  });

  it("converts single word", () => {
    expect(toScreamingSnake("debug")).toBe("DEBUG");
  });

  it("converts multiple humps", () => {
    expect(toScreamingSnake("corsOrigins")).toBe("CORS_ORIGINS");
  });

  it("converts multi-word camelCase", () => {
    expect(toScreamingSnake("maxAgentIterations")).toBe(
      "MAX_AGENT_ITERATIONS",
    );
  });

  it("converts consecutive uppercase runs correctly", () => {
    expect(toScreamingSnake("githubClientId")).toBe("GITHUB_CLIENT_ID");
  });

  it("handles already uppercase single char words", () => {
    expect(toScreamingSnake("dbPath")).toBe("DB_PATH");
  });
});
