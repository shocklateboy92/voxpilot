import { createSignal, For, Show } from "solid-js";
import {
  speechConfigurationError,
  speechConnection,
} from "../../platform/speech";
import { Button } from "../../ui/Button";
import type { VoiceTake } from "./create-voice-take";
import { vocabularyFits } from "./create-voice-take";

export function VoiceTranscription(props: {
  take: VoiceTake;
  disabled: boolean;
  onDiscard: () => void;
}) {
  const [confirmNew, setConfirmNew] = createSignal(false);
  const available = () => Boolean(speechConnection());
  return (
    <div class="flex min-w-0 flex-col gap-2 px-2 py-2">
      <Show
        when={available()}
        fallback={
          <p class="m-0 text-xs text-muted">
            {speechConfigurationError() ?? "Transcription is not configured."}
          </p>
        }
      >
        <Show when={props.take.phase() === "subset"}>
          <fieldset class="flex max-h-56 min-w-0 flex-col gap-1 overflow-y-auto">
            <legend class="text-sm font-semibold">
              Choose vocabulary subset
            </legend>
            <For each={props.take.terms()}>
              {(term) => (
                <label class="flex min-h-9 items-start gap-2 break-all text-sm">
                  <input
                    type="checkbox"
                    class="mt-1 shrink-0 accent-accent"
                    checked={props.take.selectedTerms().includes(term)}
                    onChange={(event) =>
                      props.take.setSelectedTerms((terms) =>
                        event.currentTarget.checked
                          ? [...terms, term]
                          : terms.filter((value) => value !== term),
                      )
                    }
                  />
                  {term}
                </label>
              )}
            </For>
          </fieldset>
          <p class="m-0 text-xs text-muted">
            {props.take.selectedTerms().length}/30 terms ·{" "}
            {props.take
              .selectedTerms()
              .reduce((total, term) => total + term.length, 0)}
            /2000 characters
          </p>
          <Button
            size="sm"
            disabled={
              props.disabled || !vocabularyFits(props.take.selectedTerms())
            }
            onClick={() => void props.take.continueSubset()}
          >
            Use selected vocabulary
          </Button>
        </Show>
        <Show
          when={props.take.busy()}
          fallback={
            <Show
              when={props.take.phase() === "ready"}
              fallback={
                <Show
                  when={
                    props.take.phase() === "failed" ||
                    props.take.phase() === "cancelled"
                  }
                >
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={props.disabled}
                    onClick={() => void props.take.transcribe()}
                  >
                    Retry same transcription
                  </Button>
                </Show>
              }
            >
              <Button
                variant="primary"
                size="sm"
                disabled={props.disabled || !props.take.canSend()}
                onClick={() => void props.take.sendTranscript()}
              >
                Send transcript
              </Button>
              <Show when={!props.take.canSend()}>
                <p class="m-0 text-xs text-muted">
                  Return to the original conversation and use Type to send.
                </p>
              </Show>
            </Show>
          }
        >
          <Button
            variant="reject"
            size="sm"
            disabled={props.take.phase() === "sending"}
            onClick={() => props.take.cancel()}
          >
            Cancel transcription
          </Button>
        </Show>
        <Show
          when={
            props.take.phase() === "failed" ||
            props.take.phase() === "cancelled"
          }
        >
          <Show
            when={confirmNew()}
            fallback={
              <Button
                size="sm"
                disabled={props.disabled}
                onClick={() => setConfirmNew(true)}
              >
                Start a new paid attempt…
              </Button>
            }
          >
            <Button
              size="sm"
              disabled={props.disabled}
              onClick={() => {
                void props.take.newAttempt();
                setConfirmNew(false);
              }}
            >
              Confirm new paid attempt
            </Button>
          </Show>
        </Show>
      </Show>
      <Show when={!props.take.busy()}>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          onClick={props.onDiscard}
        >
          Discard recording
        </Button>
      </Show>
      <Show when={props.take.busy() || props.take.message()}>
        <p
          class="m-0 text-xs text-muted"
          role="status"
          aria-label="Transcription status"
        >
          {props.take.busy()
            ? props.take.phase() === "sending"
              ? "Sending transcript…"
              : "Transcribing with OpenAI…"
            : props.take.message()}
        </p>
      </Show>
    </div>
  );
}
