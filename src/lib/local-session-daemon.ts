import { resolve } from "node:path";
import { createCredentialSecret } from "../credentials/secret.js";
import type { CredentialKind } from "../credentials/types.js";
import { parseTeamId } from "../domain/team-id.js";
import { SlackAuthTestVerifier } from "../slack/auth-test-verifier.js";
import { invokeSlackWebApi, startLocalSessionBroker } from "./local-session-broker.js";
import { prepareLocalSessionPaths, validateWorkspaceProfile } from "./local-session-files.js";
import type { LocalSessionConnection } from "./local-session-web-client.js";

const MAX_BOOTSTRAP_BYTES = 64 * 1024;

export async function runLocalSessionDaemonFromStdin(): Promise<void> {
  await runLocalSessionDaemon(parseBootstrap(await readBootstrap()));
  process.stdout.write("READY\n");
}

export async function runLocalSessionDaemon(bootstrap: {
  readonly token: string;
  readonly profile?: string;
  readonly configHome: string;
  readonly connection: LocalSessionConnection;
}): Promise<void> {
  const profile = bootstrap.profile === undefined ? undefined : validateWorkspaceProfile(bootstrap.profile);
  if (bootstrap.token.startsWith("xoxe.")) {
    throw new Error("Enterprise org tokens are not supported by local sessions");
  }
  const secret = createCredentialSecret(bootstrap.token, bootstrap.connection.credentialKind);
  try {
    const identity = await new SlackAuthTestVerifier().verify(secret);
    if (
      identity.teamId !== bootstrap.connection.teamId ||
      (bootstrap.connection.credentialKind === "user" && identity.botId !== undefined) ||
      (bootstrap.connection.credentialKind === "bot" && identity.botId === undefined)
    ) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error("Local session credential verification failed");
  } finally {
    secret.destroy();
  }
  const paths = await prepareLocalSessionPaths({
    configHome: bootstrap.configHome,
    ...(profile === undefined ? {} : { profile }),
    teamId: bootstrap.connection.teamId,
    credentialKind: bootstrap.connection.credentialKind,
  });
  if (paths.socketPath !== bootstrap.connection.socketPath) {
    throw new Error("Local session bootstrap path mismatch");
  }
  const broker = await startLocalSessionBroker({
    paths,
    connection: bootstrap.connection,
    token: bootstrap.token,
    invokeSlack: invokeSlackWebApi,
    onRevoked: () => process.exit(0),
  });
  process.title = `slamy-session:${bootstrap.connection.teamId}:${bootstrap.connection.credentialKind}${profile === undefined ? "" : `:${profile}`}`;
  const shutdown = () => void broker.close().finally(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function parseBootstrap(value: unknown): {
  readonly token: string;
  readonly profile?: string;
  readonly configHome: string;
  readonly connection: LocalSessionConnection;
} {
  if (!isRecord(value) || value.version !== 1 || typeof value.token !== "string") {
    throw new Error("Invalid local session bootstrap");
  }
  if (typeof value.configHome !== "string" || !resolve(value.configHome).startsWith("/")) {
    throw new Error("Invalid local session bootstrap");
  }
  const profile = value.profile === undefined ? undefined : validateWorkspaceProfile(value.profile);
  const connectionValue = value.connection;
  if (!isRecord(connectionValue)) throw new Error("Invalid local session bootstrap");
  const teamId = parseTeamId(connectionValue.teamId);
  const credentialKind = parseCredentialKind(connectionValue.credentialKind);
  if (
    connectionValue.version !== 1 ||
    typeof connectionValue.socketPath !== "string" ||
    !connectionValue.socketPath.startsWith("/") ||
    typeof connectionValue.capability !== "string" ||
    connectionValue.capability.length < 16 ||
    typeof connectionValue.createdAt !== "string" ||
    !Number.isFinite(Date.parse(connectionValue.createdAt)) ||
    typeof connectionValue.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(connectionValue.expiresAt))
  ) {
    throw new Error("Invalid local session bootstrap");
  }
  return Object.freeze({
    token: value.token,
    ...(profile === undefined ? {} : { profile }),
    configHome: resolve(value.configHome),
    connection: Object.freeze({
      version: 1,
      teamId,
      credentialKind,
      socketPath: connectionValue.socketPath,
      capability: connectionValue.capability,
      createdAt: connectionValue.createdAt,
      expiresAt: connectionValue.expiresAt,
    }),
  });
}

async function readBootstrap(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BOOTSTRAP_BYTES) throw new Error("Invalid local session bootstrap");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid local session bootstrap");
  }
}

function parseCredentialKind(value: unknown): CredentialKind {
  if (value !== "user" && value !== "bot") throw new Error("Invalid local session bootstrap");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
