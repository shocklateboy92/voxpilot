import { type ComponentProps, splitProps } from "solid-js";

type TextareaProps = ComponentProps<"textarea"> & {
  variant?: "field" | "composer";
};

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["variant", "class", "classList"]);
  return (
    <textarea
      {...rest}
      class="min-w-0 font-sans text-text placeholder:text-muted disabled:opacity-50"
      classList={{
        "min-h-10 w-full resize-y rounded border border-option-border bg-option-bg px-2 py-1 text-[0.8rem] focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent":
          local.variant !== "composer",
        "max-h-40 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-1.5 text-[0.9rem] leading-[1.4] outline-none":
          local.variant === "composer",
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
