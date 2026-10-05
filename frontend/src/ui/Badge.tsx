import { type ComponentProps, splitProps } from "solid-js";

export function Badge(props: ComponentProps<"span"> & { mono?: boolean }) {
  const [local, rest] = splitProps(props, ["mono", "class", "classList"]);
  return (
    <span
      {...rest}
      class="inline-block shrink-0 rounded border border-subtle-border bg-subtle-bg px-1.5 py-0.5 text-[0.65rem] leading-tight text-muted"
      classList={{
        "font-mono": local.mono,
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
