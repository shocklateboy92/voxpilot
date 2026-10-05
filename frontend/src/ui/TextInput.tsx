import { type ComponentProps, splitProps } from "solid-js";

type TextInputProps = Omit<ComponentProps<"input">, "size"> & {
  density?: "normal" | "compact";
  mono?: boolean;
};

export function TextInput(props: TextInputProps) {
  const [local, rest] = splitProps(props, [
    "density",
    "mono",
    "class",
    "classList",
  ]);
  return (
    <input
      {...rest}
      class="min-w-0 rounded-lg border border-option-border bg-option-bg text-text placeholder:text-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
      classList={{
        "p-3": local.density !== "compact",
        "px-3 py-2 text-[0.8rem]": local.density === "compact",
        "font-mono": local.mono,
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
