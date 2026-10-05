import { type ComponentProps, splitProps } from "solid-js";

export function Panel(
  props: ComponentProps<"div"> & { tone?: "default" | "warning" },
) {
  const [local, rest] = splitProps(props, ["tone", "class", "classList"]);
  return (
    <div
      {...rest}
      class="rounded-lg border p-3"
      classList={{
        "border-border bg-surface-dark": local.tone !== "warning",
        "border-warning bg-border": local.tone === "warning",
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
