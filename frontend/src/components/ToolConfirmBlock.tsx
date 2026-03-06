/**
 * Permission prompt — Allow once / Always allow / Reject buttons.
 */

import { createSignal } from "solid-js";
import Lock from "lucide-solid/icons/lock";
import { respondToPermission } from "../api-client";
import { activeSession } from "../navigation";
import { setStore } from "../store";
import type { PendingPermission } from "../store";

interface Props {
  permission: PendingPermission;
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

  async function handleReply(reply: "once" | "always" | "reject"): Promise<void> {
    setSubmitting(true);
    try {
      const dir = activeSession()?.directory;
      await respondToPermission(props.permission.id, reply, dir);
    } catch (err: unknown) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStore("errorMessage", `Permission error: ${msg}`);
    }
  }

  return (
    <div class="tool-confirm">
      <div class="tool-confirm-header">
        <Lock size={14} /> <strong>{props.permission.permission}</strong>{" "}
        requires approval
      </div>
      <pre class="tool-confirm-args">{metadata()}</pre>
      <div class="tool-confirm-actions">
        <button
          class="btn btn-success btn-sm"
          disabled={submitting()}
          onClick={() => void handleReply("once")}
        >
          Allow once
        </button>
        <button
          class="btn btn-success btn-sm"
          disabled={submitting()}
          onClick={() => void handleReply("always")}
        >
          Always allow
        </button>
        <button
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
