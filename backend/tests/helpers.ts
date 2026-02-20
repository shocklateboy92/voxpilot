import { beforeEach, afterEach } from "bun:test";
import { closeDb } from "../src/db";

export function setupTestDb() {
  beforeEach(() => {
    process.env["VOXPILOT_DB_PATH"] = ":memory:";
  });
  afterEach(() => {
    closeDb();
  });
}
