import { type ComponentProps, splitProps } from "solid-js";

export function CodeOutput(
  props: ComponentProps<"pre"> & { error?: boolean; compact?: boolean },
) {
  const [local, rest] = splitProps(props, [
    "error",
    "compact",
    "class",
    "classList",
  ]);
  return (
    <pre
      {...rest}
      class="overflow-y-auto font-mono text-xs leading-[1.4] break-all whitespace-pre-wrap"
      classList={{
        "max-h-32": local.compact,
        "max-h-80": !local.compact,
        "text-error": local.error,
        "text-text": !local.error,
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
