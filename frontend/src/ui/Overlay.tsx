/**
 * Reusable overlay — fixed backdrop + positioned panel with dismiss behaviour.
 *
 * Handles backdrop click-to-close, Escape key, and stopPropagation on the
 * inner panel so that child click handlers work normally.
 */

import { type JSX, onCleanup, onMount } from "solid-js";

interface OverlayProps {
  label: string;
  onClose: () => void;
  /** Panel position: "bottom" (bottom sheet) or "center". Default: "bottom". */
  position?: "bottom" | "center";
  /** Extra CSS class(es) applied to the inner panel element. */
  class?: string;
  children: JSX.Element;
}

export function Overlay(props: OverlayProps) {
  let backdrop: HTMLDivElement | undefined;
  onMount(() => {
    const previous = document.activeElement;
    backdrop?.focus();
    onCleanup(() => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    });
  });

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
    if (e.key !== "Tab" || !backdrop) return;
    const focusable = Array.from(
      backdrop.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === backdrop)
    ) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const isCenter = () => props.position === "center";

  return (
    <div
      class="fixed inset-0 z-100 flex justify-center bg-overlay outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      classList={{
        "items-end": !isCenter(),
        "items-center": isCenter(),
      }}
      onClick={() => props.onClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={backdrop}
    >
      <div
        class="flex max-h-[80vh] w-full max-w-lg flex-col bg-surface pb-(--safe-bottom) text-left"
        role="document"
        classList={{
          "rounded-t-2xl": !isCenter(),
          "m-4 rounded-2xl": isCenter(),
          [props.class ?? ""]: Boolean(props.class),
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          handleKeyDown(e);
          e.stopPropagation();
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
