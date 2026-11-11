import { Portal } from "solid-js/web";
import { Overlay } from "../../../ui/Overlay";
import { OverlayHeader } from "../../../ui/OverlayHeader";

export function ImagePreview(props: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <Portal>
      <Overlay label="Image preview" position="center" onClose={props.onClose}>
        <OverlayHeader
          title={props.name}
          onClose={props.onClose}
          class="min-w-0 break-all"
        />
        <div class="min-h-0 overflow-auto p-3">
          <img
            src={props.src}
            alt={props.name}
            class="mx-auto max-h-[60vh] max-w-full object-contain"
          />
        </div>
      </Overlay>
    </Portal>
  );
}
