import { For, type JSX } from "solid-js";

export function SegmentedControl<T>(props: {
  label: string;
  options: readonly T[];
  value: string;
  optionValue: (option: T) => string;
  optionLabel: (option: T) => JSX.Element;
  optionTitle?: (option: T) => string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset
      aria-label={props.label}
      class="inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-xl border border-border bg-glass p-1 backdrop-blur-md"
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="cursor-pointer rounded-lg border-0 px-3 py-1 font-mono text-xs font-semibold whitespace-nowrap capitalize transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            classList={{
              "bg-accent text-white enabled:hover:bg-accent-hover":
                props.optionValue(option) === props.value,
              "bg-transparent text-muted enabled:hover:text-text":
                props.optionValue(option) !== props.value,
            }}
            aria-pressed={props.optionValue(option) === props.value}
            disabled={props.disabled}
            title={props.optionTitle?.(option)}
            onClick={() => props.onChange(props.optionValue(option))}
          >
            {props.optionLabel(option)}
          </button>
        )}
      </For>
    </fieldset>
  );
}
