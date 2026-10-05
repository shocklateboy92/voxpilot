import Check from "lucide-solid/icons/check";
import { type ComponentProps, Show, splitProps } from "solid-js";

export function ChoiceOption(
  props: ComponentProps<"button"> & { selected: boolean; description?: string },
) {
  const [local, rest] = splitProps(props, [
    "selected",
    "description",
    "children",
    "class",
    "classList",
  ]);
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={local.selected}
      class="flex cursor-pointer flex-col items-start rounded border px-3 py-1.5 text-left text-[0.8rem] whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      classList={{
        "border-accent bg-accent text-white": local.selected,
        "border-option-border bg-option-bg text-text": !local.selected,
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    >
      <span class="flex items-center gap-1 font-semibold">
        <Show when={local.selected}>
          <Check size={14} />
        </Show>
        {local.children}
      </span>
      <Show when={local.description}>
        <span
          class="mt-0.5 text-xs leading-[1.3]"
          classList={{
            "text-white/80": local.selected,
            "text-muted": !local.selected,
          }}
        >
          {local.description}
        </span>
      </Show>
    </button>
  );
}
