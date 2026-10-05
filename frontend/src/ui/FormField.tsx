import { createUniqueId, type JSX, Show } from "solid-js";

export function FormField(props: {
  label: string;
  description?: string;
  error?: string;
  children: (attributes: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean;
  }) => JSX.Element;
}) {
  const id = createUniqueId();
  return (
    <div class="flex flex-col gap-2">
      <label for={id}>{props.label}</label>
      {props.children({
        id,
        get "aria-describedby"() {
          return props.error || props.description ? `${id}-help` : undefined;
        },
        get "aria-invalid"() {
          return Boolean(props.error);
        },
      })}
      <Show when={props.error || props.description}>
        <p
          id={`${id}-help`}
          class="text-sm"
          classList={{
            "text-error": Boolean(props.error),
            "text-muted": !props.error,
          }}
        >
          {props.error || props.description}
        </p>
      </Show>
    </div>
  );
}
