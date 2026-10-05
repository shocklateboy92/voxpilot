/**
 * Centered loading spinner.
 *
 * Pass `fullscreen` to fill the viewport (used for the initial app load).
 * Without it, the spinner fills its parent via `flex: 1` (used inside
 * flex containers like the review overlay pane).
 */

export function Spinner(props: { fullscreen?: boolean }) {
  return (
    <div
      class="flex flex-1 items-center justify-center"
      classList={{
        "min-h-dvh": props.fullscreen,
        "min-h-full": !props.fullscreen,
      }}
      role="status"
      aria-label="Loading"
    >
      <div class="size-8 animate-spin rounded-full border-[3px] border-border border-t-text" />
    </div>
  );
}
