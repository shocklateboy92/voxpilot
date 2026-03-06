/**
 * Question prompt — renders questions from the AI and handles replies/rejection.
 */

import type {
  QuestionAnswer,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client";
import { createSignal, For, Show } from "solid-js";
import { rejectQuestion, replyToQuestion } from "../api-client";
import { activeSession } from "../navigation";
import { setStore } from "../store";

interface Props {
  request: QuestionRequest;
}

export function QuestionBlock(props: Props) {
  // Per-question answers (each entry is an array of selected labels).
  // Starts empty; entries are created on demand via toggleOption/setCustom.
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>([]);
  const [customInputs, setCustomInputs] = createSignal<string[]>([]);

  function toggleOption(qIndex: number, label: string): void {
    const q = props.request.questions[qIndex];
    if (!q) return;
    setAnswers((prev) => {
      const next = [...prev];
      const current = next[qIndex] ?? [];
      if (q.multiple) {
        if (current.includes(label)) {
          next[qIndex] = current.filter((l) => l !== label);
        } else {
          next[qIndex] = [...current, label];
        }
      } else {
        next[qIndex] = [label];
      }
      return next;
    });
  }

  function setCustom(qIndex: number, value: string): void {
    setCustomInputs((prev) => {
      const next = [...prev];
      next[qIndex] = value;
      return next;
    });
    setAnswers((prev) => {
      const next = [...prev];
      const current = next[qIndex] ?? [];
      const q = props.request.questions[qIndex];
      const withoutCustom = q
        ? current.filter((l) => q.options.some((o) => o.label === l))
        : current;
      next[qIndex] = value.trim()
        ? [...withoutCustom, value.trim()]
        : withoutCustom;
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    try {
      const dir = activeSession()?.directory;
      await replyToQuestion(props.request.id, answers(), dir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStore("errorMessage", `Question error: ${msg}`);
    }
  }

  async function handleReject(): Promise<void> {
    try {
      const dir = activeSession()?.directory;
      await rejectQuestion(props.request.id, dir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStore("errorMessage", `Question error: ${msg}`);
    }
  }

  const allAnswered = () =>
    props.request.questions.every((_, i) => (answers()[i]?.length ?? 0) > 0);

  return (
    <div class="question-block">
      <For each={props.request.questions}>
        {(q, qIndex) => (
          <div class="question-item">
            <div class="question-header">{q.header}</div>
            <div class="question-text">{q.question}</div>
            <div class="question-options">
              <For each={q.options}>
                {(opt) => {
                  const selected = () =>
                    (answers()[qIndex()] ?? []).includes(opt.label);
                  return (
                    <button
                      type="button"
                      class={`question-option${selected() ? " selected" : ""}`}
                      title={opt.description}
                      onClick={() => toggleOption(qIndex(), opt.label)}
                    >
                      {opt.label}
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={q.custom !== false}>
              <input
                class="question-custom-input"
                type="text"
                placeholder="Or type a custom answer…"
                value={customInputs()[qIndex()] ?? ""}
                onInput={(e) => setCustom(qIndex(), e.currentTarget.value)}
              />
            </Show>
          </div>
        )}
      </For>
      <div class="question-actions">
        <button
          type="button"
          class="btn btn-success btn-sm"
          disabled={!allAnswered()}
          onClick={() => void handleSubmit()}
        >
          Submit
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          onClick={() => void handleReject()}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
