/**
 * Tool confirmation prompt — Approve / Reject buttons for
 * tools that require user confirmation before execution.
 */

import type { PendingConfirm } from "../store";
import { respondToConfirm } from "../streaming";

interface Props {
  confirm: PendingConfirm;
}

export function ToolConfirmBlock(props: Props) {
  const argsText = () => {
    try {
      return JSON.stringify(JSON.parse(props.confirm.arguments), null, 2);
    } catch {
      return props.confirm.arguments;
    }
  };

  return (
    <div class="tool-confirm" data-tool-call-id={props.confirm.id}>
      <div class="tool-confirm-header">
        🔒 <strong>{props.confirm.name}</strong> requires approval
      </div>
      <pre class="tool-confirm-args">{argsText()}</pre>
      <div class="tool-confirm-actions">
        <button
          class="btn btn-approve"
          onClick={() => void respondToConfirm(props.confirm.id, true)}
        >
          Approve
        </button>
        <button
          class="btn btn-reject"
          onClick={() => void respondToConfirm(props.confirm.id, false)}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
