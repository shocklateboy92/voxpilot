import X from "lucide-solid/icons/x";
import { IconButton } from "./IconButton";

export function OverlayHeader(props: {
  title: string;
  onClose: () => void;
  class?: string;
}) {
  return (
    <header
      class="flex items-center justify-between border-b border-border px-4 pt-4 pb-2"
      classList={{ [props.class ?? ""]: Boolean(props.class) }}
    >
      <h2 class="text-[1.1rem] font-semibold">{props.title}</h2>
      <IconButton variant="ghost" aria-label="Close" onClick={props.onClose}>
        <X size={18} />
      </IconButton>
    </header>
  );
}
