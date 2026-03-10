/**
 * Question prompt — renders questions from the AI and handles replies/rejection.
 */

import type {
  QuestionAnswer,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client";
import { createSignal, For, Show } from "solid-js";
import Check from "lucide-solid/icons/check";
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
  const [submitting, setSubmitting] = createSignal(false);

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
        next[qIndex] = current.includes(label) ? [] : [label];
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
    setSubmitting(true);
    try {
      const dir = activeSession()?.directory;
      await replyToQuestion(props.request.id, answers(), dir);
    } catch (err: unknown) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStore("errorMessage", `Question error: ${msg}`);
    }
  }

  async function handleReject(): Promise<void> {
    setSubmitting(true);
    try {
      const dir = activeSession()?.directory;
      await rejectQuestion(props.request.id, dir);
    } catch (err: unknown) {
      setSubmitting(false);
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
                      class={`btn btn-sm question-option${selected() ? " selected" : ""}`}
                      disabled={submitting()}
                      onClick={() => toggleOption(qIndex(), opt.label)}
                    >
                      <span class="question-option-label">
                        <Show when={selected()}>
                          <Check size={14} />
                        </Show>
                        {opt.label}
                      </span>
                      <Show when={opt.description}>
                        <span class="question-option-desc">
                          {opt.description}
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={q.custom !== false}>
              <textarea
                class="question-custom-input"
                placeholder="Or type a custom answer…"
                rows={2}
                value={customInputs()[qIndex()] ?? ""}
                disabled={submitting()}
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
          disabled={!allAnswered() || submitting()}
          onClick={() => void handleSubmit()}
        >
          Submit
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          disabled={submitting()}
          onClick={() => void handleReject()}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
