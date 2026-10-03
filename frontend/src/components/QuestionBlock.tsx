/** Native session form, with typed answers keyed by field key. */
import type { FormAnswer, FormDetail } from "@opencode/client";
import Check from "lucide-solid/icons/check";
import { createSignal, For, Show } from "solid-js";
import { rejectQuestion, replyToQuestion } from "../api-client";

interface Props {
  request: FormDetail;
}

export function QuestionBlock(props: Props) {
  const [answers, setAnswers] = createSignal<
    Record<string, FormAnswer[string] | undefined>
  >({});
  const [submitting, setSubmitting] = createSignal(false);
  const value = (field: FormDetail["fields"][number]) =>
    Object.hasOwn(answers(), field.key)
      ? answers()[field.key]
      : "default" in field
        ? field.default
        : undefined;
  const active = (field: FormDetail["fields"][number]) => {
    if (field.type === "external") return true;
    return (
      field.when?.every((condition) => {
        const dependency = props.request.fields.find(
          (entry) => entry.key === condition.key,
        );
        const current = dependency ? value(dependency) : undefined;
        if (current === undefined) return false;
        const matches = Array.isArray(current)
          ? typeof condition.value === "string" &&
            current.includes(condition.value)
          : current === condition.value;
        return condition.op === "eq" ? matches : !matches;
      }) ?? true
    );
  };
  const visible = (field: FormDetail["fields"][number]) =>
    active(field) && (field.type === "external" || !field.hidden);
  const disabled = () =>
    submitting() || props.request.state.status !== "pending";

  function setValue(key: string, answer: FormAnswer[string] | undefined): void {
    setAnswers((previous) => ({ ...previous, [key]: answer }));
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (disabled() || !valid()) return;
    const answer: FormAnswer = {};
    for (const field of props.request.fields) {
      if (!active(field) || field.type === "external") continue;
      const current = value(field);
      if (current !== undefined) answer[field.key] = current;
    }
    setSubmitting(true);
    try {
      await replyToQuestion(props.request.sessionID, props.request.id, answer);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(): Promise<void> {
    if (disabled()) return;
    setSubmitting(true);
    try {
      await rejectQuestion(props.request.sessionID, props.request.id);
    } finally {
      setSubmitting(false);
    }
  }

  const valid = () =>
    props.request.fields.every((field) => {
      if (!visible(field) || field.type === "external") return true;
      const current = value(field);
      if (
        (field.required || props.request.metadata?.kind === "question") &&
        (current === undefined ||
          current === "" ||
          (Array.isArray(current) && current.length === 0))
      )
        return false;
      if (field.type === "multiselect" && Array.isArray(current)) {
        return (
          current.length >= (field.minItems ?? 0) &&
          current.length <= (field.maxItems ?? Infinity)
        );
      }
      return true;
    });

  return (
    <form class="question-block" onSubmit={(event) => void handleSubmit(event)}>
      <div class="question-header">{props.request.title}</div>
      <For each={props.request.fields}>
        {(field) => {
          const options = () =>
            field.type === "string" || field.type === "multiselect"
              ? (field.options ?? [])
              : [];
          const selected = (option: string) => {
            const current = value(field);
            return Array.isArray(current)
              ? current.includes(option)
              : current === option;
          };
          const custom = () => {
            const current = value(field);
            if (Array.isArray(current))
              return current
                .filter(
                  (entry) =>
                    !options().some((option) => option.value === entry),
                )
                .join("\n");
            return typeof current === "string" &&
              !options().some((option) => option.value === current)
              ? current
              : "";
          };
          return (
            <Show when={visible(field)}>
              <div class="question-item">
                <div class="question-header">{field.title ?? field.key}</div>
                <Show when={field.description}>
                  <div class="question-text">{field.description}</div>
                </Show>
                <Show when={field.type === "external" && field}>
                  {(external) => (
                    <a
                      href={
                        /^https?:\/\//i.test(external().url)
                          ? external().url
                          : undefined
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open {external().title ?? "link"}
                    </a>
                  )}
                </Show>
                <div class="question-options">
                  <For each={options()}>
                    {(option) => (
                      <button
                        type="button"
                        class="btn btn-sm question-option"
                        classList={{ selected: selected(option.value) }}
                        disabled={disabled()}
                        onClick={() => {
                          if (field.type !== "multiselect") {
                            setValue(
                              field.key,
                              selected(option.value) ? "" : option.value,
                            );
                            return;
                          }
                          const current = value(field);
                          const entries = Array.isArray(current) ? current : [];
                          setValue(
                            field.key,
                            selected(option.value)
                              ? entries.filter(
                                  (entry) => entry !== option.value,
                                )
                              : [...entries, option.value],
                          );
                        }}
                      >
                        <span class="question-option-label">
                          <Show when={selected(option.value)}>
                            <Check size={14} />
                          </Show>
                          {option.label}
                        </span>
                        <Show when={option.description}>
                          <span class="question-option-desc">
                            {option.description}
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={field.type === "string" && field}>
                  {(text) => (
                    <Show when={!text().options?.length || text().custom}>
                      <input
                        class="question-custom-input"
                        type={
                          text().format === "email"
                            ? "email"
                            : text().format === "uri"
                              ? "url"
                              : text().format === "date"
                                ? "date"
                                : "text"
                        }
                        aria-label={field.title ?? field.key}
                        value={custom()}
                        placeholder={text().placeholder ?? "Type an answer"}
                        required={text().required && !value(field)}
                        minLength={text().minLength}
                        maxLength={text().maxLength}
                        pattern={text().pattern}
                        disabled={disabled()}
                        onInput={(event) =>
                          setValue(field.key, event.currentTarget.value)
                        }
                      />
                    </Show>
                  )}
                </Show>
                <Show when={field.type === "multiselect" && field.custom}>
                  <textarea
                    class="question-custom-input"
                    aria-label={`Custom answers for ${field.title ?? field.key}`}
                    placeholder="Custom answers, one per line"
                    rows={2}
                    value={custom()}
                    disabled={disabled()}
                    onInput={(event) => {
                      const current = value(field);
                      const entries = Array.isArray(current)
                        ? current.filter((entry) =>
                            options().some((option) => option.value === entry),
                          )
                        : [];
                      setValue(field.key, [
                        ...new Set([
                          ...entries,
                          ...event.currentTarget.value
                            .split("\n")
                            .map((entry) => entry.trim())
                            .filter(Boolean),
                        ]),
                      ]);
                    }}
                  />
                </Show>
                <Show
                  when={
                    (field.type === "number" || field.type === "integer") &&
                    field
                  }
                >
                  {(numeric) => (
                    <input
                      class="question-custom-input"
                      type="number"
                      aria-label={field.title ?? field.key}
                      value={String(value(field) ?? "")}
                      step={numeric().type === "integer" ? 1 : "any"}
                      min={numeric().minimum}
                      max={numeric().maximum}
                      required={numeric().required}
                      disabled={disabled()}
                      onInput={(event) =>
                        setValue(
                          field.key,
                          Number.isFinite(event.currentTarget.valueAsNumber)
                            ? event.currentTarget.valueAsNumber
                            : undefined,
                        )
                      }
                    />
                  )}
                </Show>
                <Show when={field.type === "boolean"}>
                  <select
                    class="question-custom-input"
                    aria-label={field.title ?? field.key}
                    value={String(value(field) ?? "")}
                    disabled={disabled()}
                    onChange={(event) =>
                      setValue(
                        field.key,
                        event.currentTarget.value === ""
                          ? undefined
                          : event.currentTarget.value === "true",
                      )
                    }
                  >
                    <option value="">Select an answer</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </Show>
              </div>
            </Show>
          );
        }}
      </For>
      <div class="question-actions">
        <button
          type="submit"
          class="btn btn-success btn-sm"
          disabled={!valid() || disabled()}
        >
          Submit
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          disabled={disabled()}
          onClick={() => void handleReject()}
        >
          Reject
        </button>
      </div>
    </form>
  );
}
