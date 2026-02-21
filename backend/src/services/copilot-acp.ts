import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type PromptResponse,
  type StopReason,
} from "@agentclientprotocol/sdk";
import type { Subprocess } from "bun";

// TODO: Make the copilot CLI path configurable via config.ts
const COPILOT_COMMAND = "copilot";

/** Callback for streaming text deltas from Copilot */
export type OnDelta = (content: string) => void;

/**
 * Wraps a Bun FileSink (proc.stdin) into a web WritableStream<Uint8Array>
 * suitable for ndJsonStream.
 */
function fileSinkToWritableStream(
  sink: Subprocess<"pipe", "pipe", "inherit">["stdin"],
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      sink.write(chunk);
    },
    close() {
      sink.end();
    },
    abort() {
      sink.end();
    },
  });
}

/**
 * Manages a per-voxpilot-session ACP connection to the Copilot CLI.
 *
 * A single child process hosts multiple ACP sessions, allowing the main AI
 * to start independent coding tasks without spawning new processes.
 */
export class CopilotConnection {
  /** The child `copilot --acp --stdio` process */
  private proc: Subprocess<"pipe", "pipe", "inherit">;

  /** The ACP client-side connection */
  private connection: ClientSideConnection;

  /** Maps logical session names → ACP session IDs */
  readonly sessions = new Map<string, string>();

  /** Per-tool-call output buffer for SSE reconnect replay */
  readonly outputBuffer = new Map<string, string>();

  /** Current onDelta callback, set per-prompt */
  private currentOnDelta: OnDelta | undefined;

  /** Current ACP session ID receiving updates, set per-prompt */
  private currentSessionId: string | undefined;

  private constructor(
    proc: Subprocess<"pipe", "pipe", "inherit">,
    connection: ClientSideConnection,
  ) {
    this.proc = proc;
    this.connection = connection;
  }

  /**
   * Spawns a copilot child process, creates the ACP connection, and
   * initialises the protocol handshake.
   */
  static async getOrCreate(
    sessionId: string,
    workDir: string,
  ): Promise<CopilotConnection> {
    const existing = connections.get(sessionId);
    if (existing) return existing;

    const proc = Bun.spawn([COPILOT_COMMAND, "--acp", "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      cwd: workDir,
    });

    const writable = fileSinkToWritableStream(proc.stdin);
    const readable = proc.stdout as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(writable, readable);

    let instance: CopilotConnection | undefined;

    const client: Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        // Auto-approve: pick the first "allow_once" option, or fall back to first option
        const allowOption = params.options.find(
          (opt) => opt.kind === "allow_once",
        );
        const selectedOption = allowOption ?? params.options[0];
        if (!selectedOption) {
          return { outcome: { outcome: "cancelled" } };
        }
        return {
          outcome: {
            outcome: "selected",
            optionId: selectedOption.optionId,
          },
        };
      },

      async sessionUpdate(params: SessionNotification): Promise<void> {
        const update = params.update;
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        ) {
          instance?.currentOnDelta?.(update.content.text);
        }
      },
    };

    const connection = new ClientSideConnection(
      (_agent: Agent) => client,
      stream,
    );

    instance = new CopilotConnection(proc, connection);
    connections.set(sessionId, instance);

    // Perform the ACP protocol handshake
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });

    return instance;
  }

  /**
   * Looks up a named ACP session or creates a new one.
   * Returns the ACP session ID.
   */
  async getOrCreateSession(name: string, workDir: string): Promise<string> {
    const existing = this.sessions.get(name);
    if (existing) return existing;

    const result = await this.connection.newSession({
      cwd: workDir,
      mcpServers: [],
    });

    this.sessions.set(name, result.sessionId);
    return result.sessionId;
  }

  /**
   * Loads a previously-persisted ACP session (e.g. after backend restart).
   * Copilot replays the full conversation history via session/update notifications.
   */
  async loadSession(
    name: string,
    acpSessionId: string,
    workDir: string,
  ): Promise<void> {
    await this.connection.loadSession({
      sessionId: acpSessionId,
      cwd: workDir,
      mcpServers: [],
    });

    this.sessions.set(name, acpSessionId);
  }

  /**
   * Sends a prompt to a named ACP session and streams text deltas via the
   * onDelta callback. Returns the stop reason when the prompt completes.
   */
  async prompt(
    sessionName: string,
    text: string,
    onDelta: OnDelta,
  ): Promise<StopReason> {
    const acpSessionId = this.sessions.get(sessionName);
    if (!acpSessionId) {
      throw new Error(
        `No ACP session found for name "${sessionName}". Call getOrCreateSession first.`,
      );
    }

    this.currentOnDelta = onDelta;
    this.currentSessionId = acpSessionId;

    try {
      const result: PromptResponse = await this.connection.prompt({
        sessionId: acpSessionId,
        prompt: [{ type: "text", text }],
      });

      return result.stopReason;
    } finally {
      this.currentOnDelta = undefined;
      this.currentSessionId = undefined;
    }
  }

  /** Kills the child process and cleans up. */
  destroy(): void {
    this.proc.kill();
    this.sessions.clear();
    this.outputBuffer.clear();
    this.currentOnDelta = undefined;
    this.currentSessionId = undefined;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton map of connections keyed by voxpilot session ID
// ---------------------------------------------------------------------------

const connections = new Map<string, CopilotConnection>();

/**
 * Returns (or lazily creates) the CopilotConnection for a voxpilot session.
 */
export async function getConnection(
  sessionId: string,
  workDir: string,
): Promise<CopilotConnection> {
  return CopilotConnection.getOrCreate(sessionId, workDir);
}

/**
 * Tears down the CopilotConnection for a voxpilot session.
 */
export function destroyConnection(sessionId: string): void {
  const conn = connections.get(sessionId);
  if (conn) {
    conn.destroy();
    connections.delete(sessionId);
  }
}
