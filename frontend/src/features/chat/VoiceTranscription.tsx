import { createSignal, Match, Show, Switch } from "solid-js";
import {
  speechConfigurationError,
  speechConnection,
} from "../../platform/speech";
import { Button } from "../../ui/Button";
import type { VoiceTake } from "./create-voice-take";

export function VoiceTranscription(props: {
  take: VoiceTake;
  disabled: boolean;
  onDiscard: () => void;
}) {
  const [confirmNew, setConfirmNew] = createSignal(false);
  const available = () => Boolean(speechConnection());
  const newAttempt = () => {
    const recovery = props.take.recovery();
    return recovery?.kind === "new" || recovery?.kind === "recover"
      ? recovery
      : undefined;
  };
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
        <Switch>
          <Match when={props.take.phase() === "ready"}>
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
          </Match>
          <Match
            when={
              props.take.recovery()?.kind === "retry" ||
              props.take.recovery()?.kind === "recover"
            }
          >
            <Button
              variant="primary"
              size="sm"
              disabled={props.disabled}
              onClick={() => {
                setConfirmNew(false);
                void props.take.transcribe();
              }}
            >
              {props.take.recovery()?.kind === "recover"
                ? "Recover transcription"
                : "Retry same transcription"}
            </Button>
          </Match>
          <Match when={props.take.busy()}>
            <Button
              variant="reject"
              size="sm"
              disabled={props.take.phase() === "sending"}
              onClick={() => props.take.cancel()}
            >
              Cancel transcription
            </Button>
          </Match>
        </Switch>
        <Show when={newAttempt()}>
          {(recovery) => (
            <>
              <p class="m-0 text-xs text-warning">
                {recovery().providerMayHaveProcessed
                  ? "The previous attempt may already have been charged. A new attempt may incur another charge."
                  : "A new transcription attempt may incur a charge."}
              </p>
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
            </>
          )}
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
