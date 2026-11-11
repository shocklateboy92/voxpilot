import type { ComponentProps } from "solid-js";

/** Shared composer surface for a new conversation and the floating chat input. */
export function ComposerForm(
  props: Omit<ComponentProps<"form">, "class" | "classList">,
) {
  return (
    <form
      {...props}
      class="chat-form flex w-full min-w-0 max-w-[66rem] flex-col rounded-[1.25rem] border border-border bg-glass p-1.5 backdrop-blur-md focus-within:border-accent"
    />
  );
}
