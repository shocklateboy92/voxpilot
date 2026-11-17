import { type ComponentProps, splitProps } from "solid-js";

/** Shared composer surface for a new conversation and the floating chat input. */
export function ComposerForm(
  props: Omit<ComponentProps<"form">, "class" | "classList"> & {
    compact?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["compact"]);
  return (
    <form
      {...rest}
      class="chat-form flex min-w-0 flex-col"
      classList={{
        "relative items-end": local.compact,
        "w-full max-w-[66rem] rounded-[1.25rem] border border-border bg-glass p-1.5 backdrop-blur-md focus-within:border-accent":
          !local.compact,
      }}
    />
  );
}
