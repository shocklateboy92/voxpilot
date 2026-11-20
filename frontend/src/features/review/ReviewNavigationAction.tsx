import GitCompare from "lucide-solid/icons/git-compare-arrows";
import List from "lucide-solid/icons/list";
import { Show } from "solid-js";
import { Button } from "../../ui/Button";
import { resumeReview, reviewFile } from "./review-navigation";

export function ReviewNavigationAction(props: {
  reading: boolean;
  onOpenFiles: () => void;
}) {
  return (
    <Button
      size="sm"
      pill={props.reading}
      class="min-h-11"
      classList={{ "shadow-floating": props.reading }}
      variant={props.reading ? "neutral" : "ghost"}
      aria-haspopup={reviewFile() ? "dialog" : undefined}
      onClick={() => {
        if (reviewFile()) props.onOpenFiles();
        else resumeReview();
      }}
    >
      <Show
        when={reviewFile()}
        fallback={
          <>
            <GitCompare size={18} aria-hidden="true" />
            Resume review
          </>
        }
      >
        {(review) => (
          <>
            <List size={18} aria-hidden="true" />
            <span>
              Files · {review().fileIndex + 1}/{review().files.length}
            </span>
          </>
        )}
      </Show>
    </Button>
  );
}
