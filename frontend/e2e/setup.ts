import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { credentialSource, startTestBackend } from "./backend";
import { model, password } from "./dev";

const exec = promisify(execFile);

export default async function setup() {
  const source = await credentialSource();
  // Only copy the active account for the provider used by the suite. Keep the
  // values in memory: no exports on disk, database copies, or logged secrets.
  const credentials = (await source.credential.list()).filter(
    (credential) =>
      credential.integrationID === model.providerID && credential.active,
  );
  if (credentials.length === 0)
    throw new Error(
      "E2E requires an active GitHub Copilot credential on the source service",
    );

  await exec("just", ["build-plugin"], { cwd: "..", timeout: 60_000 });
  const backend = await startTestBackend(
    process.env.VOXPILOT_E2E_API ?? "http://127.0.0.1:18001",
    password,
  );
  try {
    for (const credential of credentials) {
      await backend.client.credential.create({
        integrationID: credential.integrationID,
        label: credential.label,
        value: credential.value,
        activate: true,
      });
    }
    return backend.stop;
  } catch {
    await backend.stop();
    // Credential API errors can contain sensitive input; report only context.
    throw new Error(
      "Could not seed GitHub Copilot credentials into the isolated E2E backend",
    );
  }
}
