import { SpeechVocabulary as VocabularySchema, VoxPilotRpc } from "@plugin/rpc";
import {
  SPEECH_MAX_TERMS,
  SPEECH_MAX_VOCABULARY_CHARACTERS,
} from "@plugin/speech-contract";
import { client } from "./connection";

export type SpeechVocabulary = ReturnType<typeof VocabularySchema.parse>;

export function vocabularyBudgetError(terms: readonly string[]) {
  const characters = terms.reduce((total, term) => total + term.length, 0);
  if (
    terms.length > SPEECH_MAX_TERMS ||
    characters > SPEECH_MAX_VOCABULARY_CHARACTERS
  )
    return `Speech vocabulary has ${terms.length} terms / ${characters} characters; the limit is ${SPEECH_MAX_TERMS} terms / ${SPEECH_MAX_VOCABULARY_CHARACTERS} characters. Shorten the vocabulary files, then refresh. Type is still available.`;
}

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
