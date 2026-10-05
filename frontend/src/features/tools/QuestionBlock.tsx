/** Native session form, with typed answers keyed by field key. */
import type { FormAnswer, FormDetail } from "@opencode/client";
import { createSignal, For, Show } from "solid-js";
import { rejectQuestion, replyToQuestion } from "../../platform/api-client";
import { Button } from "../../ui/Button";
import { ChoiceOption } from "../../ui/ChoiceOption";
import { Select } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
import { TextInput } from "../../ui/TextInput";

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
    <form
      class="question-block mt-2.5 rounded-lg border border-border bg-surface-dark p-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div class="mb-1 text-[0.8rem] font-semibold text-muted">
        {props.request.title}
      </div>
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
              <div class="mb-3 last-of-type:mb-0">
                <div class="mb-1 text-[0.8rem] font-semibold text-muted">
                  {field.title ?? field.key}
                </div>
                <Show when={field.description}>
                  <div class="mb-2 text-[0.9rem]">{field.description}</div>
                </Show>
                <Show when={field.type === "external" && field}>
                  {(external) => (
                    <a
                      class="text-accent hover:underline"
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
                <div class="mb-1.5 flex flex-col gap-2">
                  <For each={options()}>
                    {(option) => (
                      <ChoiceOption
                        type="button"
                        selected={selected(option.value)}
                        description={option.description}
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
                        {option.label}
                      </ChoiceOption>
                    )}
                  </For>
                </div>
                <Show when={field.type === "string" && field}>
                  {(text) => (
                    <Show when={!text().options?.length || text().custom}>
                      <TextInput
                        class="mt-1 w-full"
                        density="compact"
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
                  <Textarea
                    class="mt-1"
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
                    <TextInput
                      class="mt-1 w-full"
                      density="compact"
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
                  <Select
                    class="mt-1 w-full"
                    density="compact"
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
                  </Select>
                </Show>
              </div>
            </Show>
          );
        }}
      </For>
      <div class="mt-3 flex gap-2">
        <Button
          type="submit"
          variant="success"
          size="sm"
          disabled={!valid() || disabled()}
        >
          Submit
        </Button>
        <Button
          type="button"
          variant="reject"
          size="sm"
          disabled={disabled()}
          onClick={() => void handleReject()}
        >
          Reject
        </Button>
      </div>
    </form>
  );
}
