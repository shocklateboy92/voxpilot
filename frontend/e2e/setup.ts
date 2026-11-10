import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export default async function setup() {
  await exec("just", ["build-plugin"], { cwd: "..", timeout: 60_000 });
}
