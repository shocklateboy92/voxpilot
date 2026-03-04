/**
 * Shared loading spinner — wraps children in a Suspense boundary
 * with a centered spinner as the fallback.
 *
 * Use this around any subtree that contains a `createResource`
 * to prevent suspension from bubbling up to the app-level Suspense.
 *
 * Pass `fullscreen` for the app-level spinner that needs to fill
 * the viewport independently of parent sizing.
 */

import type { JSX } from "solid-js";
import { Suspense } from "solid-js";

export function LoadingSpinner(props: {
  children: JSX.Element;
  fullscreen?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div
          class="spinner-fallback"
          classList={{ "spinner-fallback--fullscreen": props.fullscreen }}
        >
          <div class="spinner" />
        </div>
      }
    >
      {props.children}
    </Suspense>
  );
}
