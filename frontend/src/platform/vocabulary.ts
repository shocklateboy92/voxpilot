import { SpeechVocabulary as VocabularySchema, VoxPilotRpc } from "@plugin/rpc";
import { client } from "./connection";

export type SpeechVocabulary = ReturnType<typeof VocabularySchema.parse>;

/** Read the selected project's lists on its OpenCode backend, not the static host. */
export async function fetchVocabulary(
  directory: string,
  remote = client,
  signal = AbortSignal.timeout(10_000),
) {
  return VocabularySchema.parse(
    await remote
      .rpc(VoxPilotRpc)
      .vocabulary({}, { location: { directory }, signal }),
  );
}
