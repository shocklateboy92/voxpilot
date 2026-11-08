/** Crash-test fixture: intentionally omit teardown to exercise stdin ownership. */
import { startTestBackend } from "./backend";

const url = process.argv[2];
const password = process.argv[3];
if (!url || !password) throw new Error("Missing crash-test backend arguments");
const backend = await startTestBackend(url, password);
process.send?.(backend.root);
