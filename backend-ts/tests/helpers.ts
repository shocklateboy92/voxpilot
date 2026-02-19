import { beforeEach, afterEach } from "bun:test";
import { initDb, closeDb } from "../src/db";

export function setupTestDb() {
  beforeEach(() => {
    initDb(":memory:");
  });
  afterEach(() => {
    closeDb();
  });
}
