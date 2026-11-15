import ChevronDown from "lucide-solid/icons/chevron-down";
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";

/** Floating summary with optional, non-modal details that never move the page. */
export function StatusBar(props: {
  left: JSX.Element;
  right: JSX.Element;
  details?: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let container: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;

  createEffect(() => {
    if (!open()) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !container?.contains(event.target))
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  const summary = () => (
    <>
      <span class="flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-xs whitespace-nowrap text-muted">
        {props.left}
      </span>
      <span class="flex items-center">{props.right}</span>
      <Show when={props.details}>
        <ChevronDown
          size={14}
          class="text-muted"
          classList={{ "rotate-180": open() }}
          aria-hidden="true"
        />
      </Show>
    </>
  );

  return (
    <div
      ref={container}
      data-status-bar
      class="absolute inset-x-3 top-[calc(var(--safe-top)+1.5rem)] z-40 rounded-[0.6rem] bg-glass backdrop-blur-md"
    >
      <Show
        when={props.details}
        fallback={
          <div class="grid min-h-(--status-bar-height) grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3.5 py-1.5">
            {summary()}
          </div>
        }
      >
        <button
          ref={trigger}
          type="button"
          aria-label="Session status"
          aria-expanded={open()}
          aria-controls={id}
          onClick={() => setOpen(!open())}
          class="grid min-h-(--status-bar-height) w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-[0.6rem] px-3.5 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
        >
          {summary()}
        </button>
        <Show when={open()}>
          <section
            id={id}
            aria-label="Session status details"
            class="max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain border-t border-border px-3.5 py-4 text-left text-sm text-text"
          >
            {props.details}
          </section>
        </Show>
      </Show>
    </div>
  );
}
