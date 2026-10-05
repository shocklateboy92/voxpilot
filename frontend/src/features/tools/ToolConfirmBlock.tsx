/**
 * Permission prompt — Allow once / Always allow / Reject buttons.
 */

import type { PermissionRequest } from "@opencode/client";
import Lock from "lucide-solid/icons/lock";
import { createSignal, Show } from "solid-js";
import { respondToPermission } from "../../platform/api-client";
import { Button } from "../../ui/Button";
import { CodeOutput } from "../../ui/CodeOutput";
import { Panel } from "../../ui/Panel";

interface Props {
  permission: PermissionRequest;
}

export function ToolConfirmBlock(props: Props) {
  const [submitting, setSubmitting] = createSignal(false);

  const metadata = () => {
    try {
      return JSON.stringify(props.permission.metadata, null, 2);
    } catch {
      return String(props.permission.metadata);
    }
  };

  async function handleReply(
    reply: "once" | "always" | "reject",
  ): Promise<void> {
    setSubmitting(true);
    try {
      await respondToPermission(
        props.permission.sessionID,
        props.permission.id,
        reply,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel tone="warning" class="tool-confirm my-1 max-w-[90%] self-start">
      <div class="mb-2 text-[0.85rem] text-warning">
        <Lock size={14} class="inline" />{" "}
        <strong>{props.permission.action}</strong> requires approval
      </div>
      <Show when={props.permission.message}>
        <p>{props.permission.message}</p>
      </Show>
      <CodeOutput compact class="my-2 rounded bg-option-bg p-2">
        {props.permission.resources.join("\n")}
      </CodeOutput>
      <CodeOutput compact class="my-2 rounded bg-option-bg p-2">
        {metadata()}
      </CodeOutput>
      <div class="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="success"
          size="sm"
          disabled={submitting()}
          onClick={() => void handleReply("once")}
        >
          Allow once
        </Button>
        <Show when={props.permission.save?.length}>
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={submitting()}
            onClick={() => void handleReply("always")}
          >
            Always allow
          </Button>
        </Show>
        <Button
          type="button"
          variant="reject"
          size="sm"
          disabled={submitting()}
          onClick={() => void handleReply("reject")}
        >
          Reject
        </Button>
      </div>
    </Panel>
  );
}
