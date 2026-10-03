/**
 * Permission prompt — Allow once / Always allow / Reject buttons.
 */

import type { PermissionRequest } from "@opencode/client";
import Lock from "lucide-solid/icons/lock";
import { createSignal, Show } from "solid-js";
import { respondToPermission } from "../api-client";

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
    <div class="tool-confirm">
      <div class="tool-confirm-header">
        <Lock size={14} /> <strong>{props.permission.action}</strong> requires
        approval
      </div>
      <Show when={props.permission.message}>
        <p>{props.permission.message}</p>
      </Show>
      <pre class="tool-confirm-args">
        {props.permission.resources.join("\n")}
      </pre>
      <pre class="tool-confirm-args">{metadata()}</pre>
      <div class="tool-confirm-actions">
        <button
          type="button"
          class="btn btn-success btn-sm"
          disabled={submitting()}
          onClick={() => void handleReply("once")}
        >
          Allow once
        </button>
        <Show when={props.permission.save?.length}>
          <button
            type="button"
            class="btn btn-success btn-sm"
            disabled={submitting()}
            onClick={() => void handleReply("always")}
          >
            Always allow
          </button>
        </Show>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          disabled={submitting()}
          onClick={() => void handleReply("reject")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
