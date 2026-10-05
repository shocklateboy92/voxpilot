import type { JSX } from "solid-js";

export function EmptyState(props: { children: JSX.Element }) {
  return (
    <div class="px-4 py-8 text-center text-[0.9rem] text-muted">
      {props.children}
    </div>
  );
}
