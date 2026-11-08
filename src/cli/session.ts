import { resolveCliWorkspaceSelector } from "./api-client.js";
import { validateWorkspaceProfile } from "../lib/local-session-files.js";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createWorkspaceRegistry,
  type WorkspaceRegistry,
} from "../lib/workspace.js";
import {
  getLocalSessionStatus,
  MAX_LOCAL_SESSION_TTL_MS,
  parseLocalSessionTtl,
  revokeLocalSession,
  startLocalSession,
  startLocalSessionForeground,
  type LocalSessionStatus,
} from "../lib/local-session-service.js";

const MAX_TOKEN_INPUT_BYTES = 16 * 1024;

type SessionCommandDependencies = {
  readonly registryFactory: () => WorkspaceRegistry;
  readonly readToken: () => Promise<string>;
  readonly start: typeof startLocalSession;
  readonly startForeground: typeof startLocalSessionForeground;
  readonly status: typeof getLocalSessionStatus;
  readonly revoke: typeof revokeLocalSession;
  readonly writeOut: (line: string) => void;
  readonly writeErr: (line: string) => void;
  readonly env: NodeJS.ProcessEnv;
  readonly cliPath: string;
  readonly executablePath: string;
  readonly execArgv: readonly string[];
};

export function registerLocalSessionCommands(
  auth: Command,
  program: Command,
  dependencies?: Partial<SessionCommandDependencies>,
): void {
  const env = dependencies?.env ?? process.env;
  const deps: SessionCommandDependencies = {
    registryFactory: dependencies?.registryFactory ?? (() => createWorkspaceRegistry({ env })),
    readToken: dependencies?.readToken ?? readTokenFromStdin,
    start: dependencies?.start ?? startLocalSession,
    startForeground: dependencies?.startForeground ?? startLocalSessionForeground,
    status: dependencies?.status ?? getLocalSessionStatus,
    revoke: dependencies?.revoke ?? revokeLocalSession,
    writeOut: dependencies?.writeOut ?? ((line) => console.log(line)),
    writeErr: dependencies?.writeErr ?? ((line) => console.error(line)),
    env,
    cliPath: dependencies?.cliPath ?? process.argv[1] ?? "",
    executablePath: dependencies?.executablePath ?? process.execPath,
    execArgv: dependencies?.execArgv ?? process.execArgv,
  };
  const session = auth.command("session").description("Manage a local in-memory Slack session");

  session
    .command("start")
    .description("Start a local session from a Slack token supplied on stdin")
    .option("--ttl <duration>", "Session lifetime such as 24h or 7d")
    .option("--foreground", "Keep the broker in the current process for a supervisor")
    .action(async (options: { ttl?: string; foreground?: boolean }) => {
      await withErrors(deps, async () => {
        const workspace = await resolveSessionWorkspace(program, deps);
        const ttlMs = parseLocalSessionTtl(options.ttl);
        const starter = options.foreground ? deps.startForeground : deps.start;
        const result = await starter({
          workspace,
          token: await deps.readToken(),
          ttlMs,
          configHome: configHome(deps.env),
          cliPath: deps.cliPath,
          executablePath: deps.executablePath,
          execArgv: deps.execArgv,
        });
        deps.writeOut(formatStatus(result, outputMode(program), "started"));
        if (ttlMs === MAX_LOCAL_SESSION_TTL_MS && outputMode(program) === "human") {
          deps.writeErr(
            "Security note: this 7-day session can be used by processes running as your macOS user until revoked or expired.",
          );
        }
      });
    });

  session
    .command("status")
    .description("Show non-secret local session status")
    .action(async () => {
      await withErrors(deps, async () => {
        const workspace = await resolveSessionWorkspace(program, deps);
        const result = await deps.status(workspace, configHome(deps.env));
        if (!result) {
          deps.writeOut(outputMode(program) === "json" ? JSON.stringify({ active: false }) : "No active local session");
          return;
        }
        deps.writeOut(formatStatus(result, outputMode(program), "active"));
      });
    });

  session
    .command("revoke")
    .description("Revoke the local session without rotating the Slack token")
    .action(async () => {
      await withErrors(deps, async () => {
        const workspace = await resolveSessionWorkspace(program, deps);
        const revoked = await deps.revoke(workspace, configHome(deps.env));
        const mode = outputMode(program);
        deps.writeOut(
          mode === "json"
            ? JSON.stringify({ revoked })
            : revoked
              ? "Local session revoked; the Slack token itself was not rotated"
              : "No active local session",
        );
      });
    });
}

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("Pipe a Slack token to stdin; tokens are not accepted as command arguments");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TOKEN_INPUT_BYTES) throw new Error("Slack token input is too large");
    chunks.push(buffer);
  }
  const token = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!token || /[\r\n\u0000]/.test(token)) throw new Error("Slack token input is invalid");
  return token;
}

function selectedWorkspace(program: Command): string | undefined {
  return program.opts<{ workspace?: string }>().workspace;
}

function configHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function outputMode(program: Command): "json" | "plain" | "human" {
  const options = program.opts<{ json?: boolean; plain?: boolean }>();
  if (options.json) return "json";
  if (options.plain) return "plain";
  return "human";
}

function formatStatus(
  status: LocalSessionStatus,
  mode: "json" | "plain" | "human",
  state: "started" | "active",
): string {
  if (mode === "json") return JSON.stringify({ active: true, ...status });
  if (mode === "plain") {
    return `${status.workspace}\t${status.teamId}\t${status.credentialKind}\t${status.createdAt}\t${status.expiresAt}${status.profile === undefined ? "" : `\t${status.profile}`}`;
  }
  return `Local session ${state} for ${status.workspace}${status.profile === undefined ? "" : ` profile ${status.profile}`} (${status.teamId}); expires ${status.expiresAt}`;
}

async function withErrors(
  dependencies: SessionCommandDependencies,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    dependencies.writeErr(
      `Error: ${error instanceof Error ? error.message : "Local session command failed"}`,
    );
    process.exitCode = 1;
  }
}

async function resolveSessionWorkspace(program: Command, deps: SessionCommandDependencies) {
  const profile = program.opts<{ profile?: string }>().profile;
  if (profile === undefined) return deps.registryFactory().resolve(selectedWorkspace(program));
  validateWorkspaceProfile(profile);
  return deps.registryFactory().resolve(resolveCliWorkspaceSelector(selectedWorkspace(program), deps.env), profile);
}
