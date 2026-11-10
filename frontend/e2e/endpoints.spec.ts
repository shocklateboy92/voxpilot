import { expect, test } from "@playwright/test";
import { workerOrigin } from "./endpoints";

test("worker and replacement origins have distinct ports", () => {
  expect(workerOrigin("http://localhost:13000", 0)).toBe(
    "http://localhost:13000",
  );
  expect(workerOrigin("http://localhost:13000", 7)).toBe(
    "http://localhost:13007",
  );
  expect(workerOrigin("http://[::1]:18001", 2)).toBe("http://[::1]:18003");
});

test("worker origins reject invalid ranges and non-origin overrides", () => {
  for (const index of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => workerOrigin("http://localhost:13000", index)).toThrow(
      "Invalid E2E worker port range",
    );
  expect(() => workerOrigin("http://localhost:65535", 1)).toThrow(
    "Invalid E2E worker port range",
  );
  for (const url of [
    "https://localhost:13000",
    "http://localhost:13000/api",
    "http://localhost:13000?server=normal",
    "http://localhost:13000/#session",
    "http://user:password@localhost:13000",
  ])
    expect(() => workerOrigin(url, 0)).toThrow(
      "E2E worker endpoints must be HTTP origins",
    );
});
