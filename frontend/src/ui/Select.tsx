import { type ComponentProps, splitProps } from "solid-js";

type SelectProps = ComponentProps<"select"> & {
  variant?: "field" | "ghost";
  density?: "normal" | "compact";
  mono?: boolean;
};

export function Select(props: SelectProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "density",
    "mono",
    "class",
    "classList",
  ]);
  return (
    <select
      {...rest}
      class="min-w-0 cursor-pointer text-ellipsis focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
      classList={{
        "rounded-lg border border-option-border bg-option-bg text-text":
          local.variant !== "ghost",
        "border-0 bg-transparent font-semibold text-muted hover:text-text":
          local.variant === "ghost",
        "p-3": local.density !== "compact",
        "px-3 py-1.5 text-[0.8rem]": local.density === "compact",
        "font-mono": local.mono,
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
