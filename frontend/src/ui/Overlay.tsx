/**
 * Reusable overlay — fixed backdrop + positioned panel with dismiss behaviour.
 *
 * Handles backdrop click-to-close, Escape key, and stopPropagation on the
 * inner panel so that child click handlers work normally.
 */

import type { JSX } from "solid-js";

interface OverlayProps {
  onClose: () => void;
  /** Panel position: "bottom" (bottom sheet) or "center". Default: "bottom". */
  position?: "bottom" | "center";
  /** Extra CSS class(es) applied to the inner panel element. */
  class?: string;
  children: JSX.Element;
}

export function Overlay(props: OverlayProps) {
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  }

  const isCenter = () => props.position === "center";

  return (
    <div
      class="overlay-backdrop"
      role="dialog"
      aria-modal="true"
      classList={{
        "overlay-bottom": !isCenter(),
        "overlay-center": isCenter(),
      }}
      onClick={() => props.onClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el.focus()}
    >
      <div
        class="overlay-panel"
        role="document"
        classList={{
          "overlay-panel-bottom": !isCenter(),
          "overlay-panel-center": isCenter(),
          [props.class ?? ""]: Boolean(props.class),
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );
}
