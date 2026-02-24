/**
 * Permission prompt — Allow once / Always allow / Reject buttons.
 */

import type { PendingPermission } from "../store"
import { respondToConfirm } from "../streaming"

interface Props {
  permission: PendingPermission
}

export function ToolConfirmBlock(props: Props) {
  const metadata = () => {
    try {
      return JSON.stringify(props.permission.metadata, null, 2)
    } catch {
      return String(props.permission.metadata)
    }
  }

  return (
    <div class="tool-confirm">
      <div class="tool-confirm-header">
        🔒 <strong>{props.permission.title}</strong> requires approval
      </div>
      <pre class="tool-confirm-args">{metadata()}</pre>
      <div class="tool-confirm-actions">
        <button
          class="btn btn-approve"
          onClick={() => void respondToConfirm(props.permission.id, "once")}
        >
          Allow once
        </button>
        <button
          class="btn btn-approve"
          onClick={() => void respondToConfirm(props.permission.id, "always")}
        >
          Always allow
        </button>
        <button
          class="btn btn-reject"
          onClick={() => void respondToConfirm(props.permission.id, "reject")}
        >
          Reject
        </button>
      </div>
    </div>
  )
}
