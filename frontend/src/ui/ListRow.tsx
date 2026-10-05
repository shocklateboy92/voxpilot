import { type ComponentProps, splitProps } from "solid-js";

export function ListRow(props: ComponentProps<"button">) {
  const [local, rest] = splitProps(props, ["class", "classList"]);
  return (
    <button
      type="button"
      {...rest}
      class="flex min-h-12 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-3 text-left text-inherit transition-colors enabled:hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      classList={{
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
