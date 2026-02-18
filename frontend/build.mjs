import { context, build } from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outdir: "dist",
  sourcemap: true,
  target: "es2022",
  format: "esm",
  loader: { ".css": "css" },
};

// Copy static assets to dist
mkdirSync("dist", { recursive: true });
copyFileSync("public/index.html", "dist/index.html");

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await build(options);
  console.log("Build complete.");
}
