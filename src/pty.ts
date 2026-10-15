import { Channel, invoke } from "@tauri-apps/api/core";

export interface PtyHandle {
  id: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

const ignore = () => {};

export async function spawnPty(opts: {
  cols: number;
  rows: number;
  cwd?: string;
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}): Promise<PtyHandle> {
  const onData = new Channel<ArrayBuffer | number[]>();
  onData.onmessage = (msg) => opts.onData(new Uint8Array(msg));
  const onExit = new Channel<number>();
  onExit.onmessage = opts.onExit;

  const id = await invoke<number>("pty_spawn", { cols: opts.cols, rows: opts.rows, cwd: opts.cwd, onData, onExit });
  return {
    id,
    write: (data) => invoke("pty_write", { id, data }).catch(ignore),
    resize: (cols, rows) => invoke("pty_resize", { id, cols, rows }).catch(ignore),
    kill: () => invoke("pty_kill", { id }).catch(ignore),
  };
}

export function processNames(ids: number[]): Promise<Record<string, string>> {
  return invoke("pty_process_names", { ids });
}

export type AgentStatus = "thinking" | "working" | "waiting" | "idle" | "error" | "unknown";

/** A coding agent running in a PTY, as read from its session files. */
export interface AgentInfo {
  harness: "claude" | "codex" | "opencode";
  status: AgentStatus;
  /** The last thing the user asked. */
  prompt: string | null;
  /** The running tool, what it's waiting on, or the error. */
  detail: string | null;
}

/** The coding agent in each PTY that's running one, by PTY id. */
export function agentStatus(ids: number[]): Promise<Record<string, AgentInfo>> {
  return invoke("agent_status", { ids });
}

export function processCwds(ids: number[]): Promise<Record<string, string>> {
  return invoke("pty_cwds", { ids });
}

/** The command running in the foreground of each busy PTY (not at the shell prompt), by PTY id. */
export function busyProcesses(ids: number[]): Promise<Record<string, string>> {
  return invoke("pty_busy", { ids });
}

/** The git repo a directory is in, as shown in a pane's status bar. */
export interface GitInfo {
  repo: string;
  branch: string;
  added: number;
  removed: number;
  /** Commits ahead of and behind the upstream branch. */
  ahead: number;
  behind: number;
}

/** Git status for each of `dirs` that's inside a repo, keyed by directory. */
export function gitStatus(dirs: string[]): Promise<Record<string, GitInfo>> {
  return invoke("git_status", { dirs });
}

/** Local branches of the repo `dir` is in, most recently committed first. */
export function gitBranches(dir: string): Promise<string[]> {
  return invoke("git_branches", { dir });
}

/** Checks out `branch` in the repo `dir` is in (creating it if `create`); rejects with git's message. */
export function gitCheckout(dir: string, branch: string, create = false): Promise<void> {
  return invoke("git_checkout", { dir, branch, create });
}

/** A process serving HTTP on a local port. */
export interface Listener {
  port: number;
  pid: number;
  /** What it is, e.g. "vite" rather than "node". */
  name: string;
  /** The PTY whose shell started it, or null if none did (Docker, or a server started elsewhere). */
  pty: number | null;
}

/**
 * Every local port that answers HTTP, and which of the PTYs `ids` started it.
 * Apps' own helpers only count when a pane started them or printed one of `ports`.
 */
export function localServers(ids: number[], ports: number[]): Promise<Listener[]> {
  return invoke("local_servers", { ids, ports });
}
