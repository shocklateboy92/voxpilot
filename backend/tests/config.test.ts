import { describe, expect, it } from "bun:test";
import type { Config } from "../src/config";

describe("config", () => {
  it("exports a typed config object with expected defaults", async () => {
    const { config } = await import("../src/config");
    const typed: Config = config;
    expect(typed.appName).toBe("VoxPilot");
    expect(typed.maxAgentIterations).toBe(25);
    expect(typed.copilotCliPath).toBe("copilot");
  });
});
