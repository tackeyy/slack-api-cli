import { randomBytes } from "node:crypto";
import type { AuthIdentity, CredentialHandle } from "../credentials/auth-verifier.js";
import {
  MAX_LOCAL_SESSION_TTL_MS,
} from "../credentials/local-session-duration.js";
export {
  MAX_LOCAL_SESSION_TTL_MS,
  parseLocalSessionTtl,
} from "../credentials/local-session-duration.js";
import { createCredentialSecret } from "../credentials/secret.js";
import type { CredentialKind } from "../credentials/types.js";
import type { WorkspaceRecord } from "../domain/workspace.js";
import { SlackAuthTestVerifier } from "../slack/auth-test-verifier.js";
import { readLocalSessionConnection, resolveLocalSessionPaths } from "./local-session-files.js";
import { revokeLocalSessionBroker } from "./local-session-broker.js";
import { runLocalSessionDaemon } from "./local-session-daemon.js";
import { launchLocalSessionDaemon } from "./local-session-launcher.js";
import type { LocalSessionConnection } from "./local-session-web-client.js";

export type LocalSessionStatus = {
  readonly workspace: string;
  readonly profile?: string;
  readonly teamId: string;
  readonly credentialKind: CredentialKind;
  readonly createdAt: string;
  readonly expiresAt: string;
};

type StartDependencies = {
  readonly verify: (secret: CredentialHandle) => Promise<AuthIdentity>;
  readonly launch: typeof launchLocalSessionDaemon;
  readonly now: () => Date;
  readonly capability: () => string;
};

const defaultDependencies: StartDependencies = {
  verify: (secret) => new SlackAuthTestVerifier().verify(secret),
  launch: launchLocalSessionDaemon,
  now: () => new Date(),
  capability: () => randomBytes(32).toString("base64url"),
};

type ForegroundDependencies = Pick<StartDependencies, "verify" | "now" | "capability"> & {
  readonly runDaemon: typeof runLocalSessionDaemon;
};

const defaultForegroundDependencies: ForegroundDependencies = {
  verify: defaultDependencies.verify,
  now: defaultDependencies.now,
  capability: defaultDependencies.capability,
  runDaemon: runLocalSessionDaemon,
};

export async function startLocalSession(
  input: {
    readonly workspace: WorkspaceRecord & { profile?: string };
    readonly token: string;
    readonly ttlMs: number;
    readonly configHome: string;
    readonly cliPath: string;
    readonly executablePath: string;
    readonly execArgv?: readonly string[];
  },
  dependencies: StartDependencies = defaultDependencies,
): Promise<LocalSessionStatus> {
  if (
    !Number.isSafeInteger(input.ttlMs) ||
    input.ttlMs <= 0 ||
    input.ttlMs > MAX_LOCAL_SESSION_TTL_MS
  ) {
    throw new Error("Local session TTL must be between 1 millisecond and 7 days");
  }
  if (input.token.startsWith("xoxe.")) {
    throw new Error("Enterprise org tokens are not supported by local sessions");
  }
  const credentialKind = requiredCredentialKind(input.workspace);
  const secret = createCredentialSecret(input.token, credentialKind);
  let identity: AuthIdentity;
  try {
    identity = await dependencies.verify(secret);
  } catch {
    throw new Error("Slack credential identity verification failed");
  } finally {
    secret.destroy();
  }
  if (
    identity.teamId !== input.workspace.teamId ||
    (credentialKind === "user" && identity.botId !== undefined) ||
    (credentialKind === "bot" && identity.botId === undefined)
  ) {
    throw new Error("Slack credential does not match the selected workspace");
  }

  const now = dependencies.now();
  const paths = resolveLocalSessionPaths({
    configHome: input.configHome,
    teamId: input.workspace.teamId,
    profile: input.workspace.profile,
    credentialKind,
  });
  if (await readLocalSessionConnection(paths, now)) {
    throw new Error("An active local session already exists; revoke it first");
  }
  const connection: LocalSessionConnection = Object.freeze({
    version: 1,
    teamId: input.workspace.teamId,
    credentialKind,
    socketPath: paths.socketPath,
    capability: dependencies.capability(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
  });
  await dependencies.launch({
    ...(input.workspace.profile === undefined ? {} : { profile: input.workspace.profile }),
    cliPath: input.cliPath,
    executablePath: input.executablePath,
    ...(input.execArgv ? { execArgv: input.execArgv } : {}),
    token: input.token,
    configHome: input.configHome,
    connection,
  });
  return publicStatus(input.workspace, connection);
}

export async function startLocalSessionForeground(
  input: Parameters<typeof startLocalSession>[0],
  dependencies: ForegroundDependencies = defaultForegroundDependencies,
): Promise<LocalSessionStatus> {
  return startLocalSession(input, {
    verify: dependencies.verify,
    now: dependencies.now,
    capability: dependencies.capability,
    launch: async (launchInput) => {
      await dependencies.runDaemon({
        ...(launchInput.profile === undefined ? {} : { profile: launchInput.profile }),
        token: launchInput.token,
        configHome: launchInput.configHome,
        connection: launchInput.connection,
      });
      return Object.freeze({ pid: process.pid });
    },
  });
}

export async function getLocalSessionStatus(
  workspace: WorkspaceRecord & { profile?: string },
  configHome: string,
  now = new Date(),
): Promise<LocalSessionStatus | undefined> {
  const paths = resolveLocalSessionPaths({
    configHome,
    teamId: workspace.teamId,
    profile: workspace.profile,
    credentialKind: requiredCredentialKind(workspace),
  });
  const connection = await readLocalSessionConnection(paths, now);
  return connection ? publicStatus(workspace, connection) : undefined;
}

export async function revokeLocalSession(
  workspace: WorkspaceRecord & { profile?: string },
  configHome: string,
  now = new Date(),
): Promise<boolean> {
  const paths = resolveLocalSessionPaths({
    configHome,
    teamId: workspace.teamId,
    profile: workspace.profile,
    credentialKind: requiredCredentialKind(workspace),
  });
  const connection = await readLocalSessionConnection(paths, now);
  if (!connection) return false;
  await revokeLocalSessionBroker(connection);
  return true;
}

export function publicStatus(
  workspace: WorkspaceRecord & { profile?: string },
  connection: LocalSessionConnection,
): LocalSessionStatus {
  return Object.freeze({
    workspace: workspace.alias,
    ...(workspace.profile === undefined ? {} : { profile: workspace.profile }),
    teamId: connection.teamId,
    credentialKind: connection.credentialKind,
    createdAt: connection.createdAt,
    expiresAt: connection.expiresAt,
  });
}

function requiredCredentialKind(workspace: WorkspaceRecord & { profile?: string }): CredentialKind {
  if (workspace.credentialRefs?.user && workspace.credentialRefs.bot) {
    throw new Error("Local sessions require a workspace with exactly one credential kind");
  }
  return workspace.credentialRefs?.user ? "user" : "bot";
}
