import type { ComponentProps } from "solid-js";

/** Shared composer surface for a new conversation and the floating chat input. */
export function ComposerForm(
  props: Omit<ComponentProps<"form">, "class" | "classList">,
) {
  return (
    <form
      {...props}
      class="chat-form flex w-full max-w-[66rem] items-end rounded-[1.25rem] border border-border bg-glass py-1.5 pr-1.5 pl-3.5 backdrop-blur-md focus-within:border-accent"
    />
  );
}
