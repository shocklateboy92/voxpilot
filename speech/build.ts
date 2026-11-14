import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  target: "bun",
  compile: { outfile: "dist/voxpilot-speech" },
  minify: true,
});
if (!result.success) throw new Error("Speech service build failed.");
await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
