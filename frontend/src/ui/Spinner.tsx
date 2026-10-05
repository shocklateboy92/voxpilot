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
      class="spinner-fallback"
      classList={{ "spinner-fallback--fullscreen": props.fullscreen }}
    >
      <div class="spinner" />
    </div>
  );
}
