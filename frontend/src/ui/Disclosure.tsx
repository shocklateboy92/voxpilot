import { type ComponentProps, splitProps } from "solid-js";

export function Disclosure(props: ComponentProps<"details">) {
  const [local, rest] = splitProps(props, ["class", "classList"]);
  return (
    <details
      {...rest}
      class="group/disclosure mt-2.5 self-stretch overflow-hidden rounded-lg border border-border bg-surface-dark text-[0.8rem] open:border-accent [&+details]:mt-0"
      classList={{
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}

export function DisclosureSummary(props: ComponentProps<"summary">) {
  const [local, rest] = splitProps(props, ["class", "classList"]);
  return (
    <summary
      {...rest}
      class="flex cursor-pointer list-none items-center gap-1 px-3 py-1.5 font-mono text-[0.8rem] text-muted select-none before:text-accent before:content-['▸'] group-open/disclosure:before:content-['▾'] [&::-webkit-details-marker]:hidden"
      classList={{
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
