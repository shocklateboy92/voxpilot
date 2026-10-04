import type { SessionMessageInfo } from "@opencode/client";
import Terminal from "lucide-solid/icons/terminal";
import type { JSX } from "solid-js";

type SyntheticMessage = Extract<SessionMessageInfo, { type: "synthetic" }>;

type ShellNotice = {
  command?: string;
  exit?: number;
  label: string;
  status: "success" | "error" | "cancelled";
  truncated: boolean;
};

export function syntheticShellNotice(
  message: SyntheticMessage,
): ShellNotice | undefined {
  const metadata = message.metadata;
  if (metadata?.source !== "shell") return undefined;

  const state =
    typeof metadata.state === "string" ? metadata.state : undefined;
  const exit = typeof metadata.exit === "number" ? metadata.exit : undefined;
  const timeout = metadata.timeout === true || state === "timeout";
  const cancelled = state === "cancelled" || state === "killed";
  const failed = state === "error" || timeout || (exit !== undefined && exit !== 0);

  return {
    command: message.description?.trim() || undefined,
    exit,
    label: timeout
      ? "Shell timed out"
      : cancelled
        ? "Shell cancelled"
        : failed
          ? "Shell failed"
          : "Shell finished",
    status: cancelled ? "cancelled" : failed ? "error" : "success",
    truncated: metadata.truncated === true,
  };
}

export function SyntheticShellNotice(props: {
  message: SyntheticMessage;
}): JSX.Element {
  const notice = () => syntheticShellNotice(props.message);

  return (
    <div class="message assistant shell-notice-message">
      <div
        class="shell-notice"
        classList={{
          "shell-notice-error": notice()?.status === "error",
          "shell-notice-cancelled": notice()?.status === "cancelled",
        }}
      >
        <Terminal size={14} />
        <span class="shell-notice-label">{notice()?.label}</span>
        {notice()?.command && (
          <span class="shell-notice-command" title={notice()?.command}>
            · {notice()?.command}
          </span>
        )}
        {notice()?.exit !== undefined && notice()?.exit !== 0 && (
          <span class="shell-notice-detail">· Exit {notice()?.exit}</span>
        )}
        {notice()?.truncated && (
          <span class="shell-notice-detail">· Output truncated</span>
        )}
      </div>
    </div>
  );
}
