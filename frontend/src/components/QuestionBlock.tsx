/**
 * Question prompt — renders questions from the AI and handles replies/rejection.
 */

import type {
  QuestionAnswer,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client";
import { createSignal, For, Show } from "solid-js";
import { rejectQuestion, replyToQuestion } from "../api-client";
import { setErrorMessage } from "../store";

interface Props {
  request: QuestionRequest;
}

export function QuestionBlock(props: Props) {
  // One answers array per question (each is an array of selected labels)
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>(
    props.request.questions.map(() => []),
  );
  const [customInputs, setCustomInputs] = createSignal<string[]>(
    props.request.questions.map(() => ""),
  );

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
      await replyToQuestion(props.request.id, answers());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(`Question error: ${msg}`);
    }
  }

  async function handleReject(): Promise<void> {
    try {
      await rejectQuestion(props.request.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(`Question error: ${msg}`);
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
                value={customInputs()[qIndex()]}
                onInput={(e) => setCustom(qIndex(), e.currentTarget.value)}
              />
            </Show>
          </div>
        )}
      </For>
      <div class="question-actions">
        <button
          type="button"
          class="btn btn-approve"
          disabled={!allAnswered()}
          onClick={() => void handleSubmit()}
        >
          Submit
        </button>
        <button
          type="button"
          class="btn btn-reject"
          onClick={() => void handleReject()}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
