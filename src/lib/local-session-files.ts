import { validateWorkspaceProfile } from "../workspace/schema.js";
export { validateWorkspaceProfile } from "../workspace/schema.js";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { join } from "node:path";
import { parseTeamId, type TeamId } from "../domain/team-id.js";
import type { WorkspaceRecord } from "../domain/workspace.js";
import type { CredentialKind } from "../credentials/types.js";
import type { LocalSessionConnection } from "./local-session-web-client.js";

export type LocalSessionPaths = {
  readonly teamId: TeamId;
  readonly credentialKind: CredentialKind;
  readonly sessionDirectory: string;
  readonly runtimeDirectory: string;
  readonly metadataPath: string;
  readonly socketPath: string;
};

export async function prepareLocalSessionPaths(input: {
  readonly configHome: string;
  readonly runtimeRoot?: string;
  readonly teamId: string;
  readonly credentialKind: CredentialKind;
  readonly profile?: string;
}): Promise<LocalSessionPaths> {
  const paths = resolveLocalSessionPaths(input);
  const slamyDirectory = join(input.configHome, "slamy");
  const sessionsDirectory = join(slamyDirectory, "sessions");
  const teamDirectory = join(sessionsDirectory, paths.teamId);
  const profileDirectories = input.profile === undefined ? [] : [
    join(teamDirectory, "profiles"), join(teamDirectory, "profiles", input.profile),
  ];
  for (const directory of [slamyDirectory, sessionsDirectory, teamDirectory, ...profileDirectories, paths.sessionDirectory]) {
    await ensurePrivateDirectory(directory);
  }
  await ensurePrivateDirectory(paths.runtimeDirectory);
  return paths;
}

export function resolveLocalSessionPaths(input: {
  readonly configHome: string;
  readonly runtimeRoot?: string;
  readonly teamId: string;
  readonly credentialKind: CredentialKind;
  readonly profile?: string;
}): LocalSessionPaths {
  const teamId = parseTeamId(input.teamId);
  validateCredentialKind(input.credentialKind);
  const slamyDirectory = join(input.configHome, "slamy");
  const sessionsDirectory = join(slamyDirectory, "sessions");
  const teamDirectory = join(sessionsDirectory, teamId);
  const profile = input.profile === undefined ? undefined : validateWorkspaceProfile(input.profile);
  const sessionDirectory = profile === undefined ? join(teamDirectory, input.credentialKind) :
    join(teamDirectory, "profiles", profile, input.credentialKind);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const runtimeDirectory = input.runtimeRoot ?? join("/tmp", `slamy-${uid}`);
  return Object.freeze({
    teamId,
    credentialKind: input.credentialKind,
    sessionDirectory,
    runtimeDirectory,
    metadataPath: join(sessionDirectory, "session.json"),
    socketPath: join(runtimeDirectory, `${teamId}-${input.credentialKind}${profile === undefined ? "" : `-${profile}`}.sock`),
  });
}

export async function findLocalSessionForWorkspace(
  workspace: WorkspaceRecord & { profile?: string },
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<LocalSessionConnection | undefined> {
  if (workspace.credentialRefs?.user && workspace.credentialRefs.bot) return undefined;
  const credentialKind: CredentialKind = workspace.credentialRefs?.user ? "user" : "bot";
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const paths = resolveLocalSessionPaths({
    configHome,
    teamId: workspace.teamId,
    profile: workspace.profile,
    credentialKind,
  });
  return readLocalSessionConnection(paths, now);
}

export async function readLocalSessionConnection(
  paths: LocalSessionPaths,
  now = new Date(),
): Promise<LocalSessionConnection | undefined> {
  let info;
  try {
    info = await lstat(paths.metadataPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (uid !== undefined && info.uid !== uid) ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("Local session metadata is not owner-only");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(paths.metadataPath, "utf8"));
  } catch {
    throw new Error("Local session metadata is invalid");
  }
  if (!isRecord(parsed)) throw new Error("Local session metadata is invalid");
  const connection = parsed as unknown as LocalSessionConnection;
  validateConnection(connection);
  if (
    connection.teamId !== paths.teamId ||
    connection.credentialKind !== paths.credentialKind ||
    connection.socketPath !== paths.socketPath
  ) {
    throw new Error("Local session metadata does not match the selected workspace");
  }
  if (Date.parse(connection.expiresAt) <= now.getTime()) {
    await rm(paths.metadataPath, { force: true });
    return undefined;
  }
  try {
    await assertPrivateDirectory(paths.sessionDirectory);
    await assertPrivateDirectory(paths.runtimeDirectory);
    await assertPrivateSocket(paths.socketPath);
    if (!(await probeSocket(paths.socketPath))) {
      await Promise.all([
        rm(paths.metadataPath, { force: true }),
        rm(paths.socketPath, { force: true }),
      ]);
      return undefined;
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await rm(paths.metadataPath, { force: true });
      return undefined;
    }
    throw error;
  }
  return Object.freeze({ ...connection });
}

function probeSocket(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.setTimeout(500);
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Local session broker did not respond"));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") finish(false);
      else reject(new Error("Local session broker is unavailable"));
    });
  });
}

export async function writeLocalSessionConnection(
  paths: LocalSessionPaths,
  connection: LocalSessionConnection,
): Promise<void> {
  validateConnection(connection);
  if (connection.socketPath !== paths.socketPath) {
    throw new Error("Local session socket path mismatch");
  }
  const temporaryPath = join(paths.sessionDirectory, `.session-${randomUUID()}.tmp`);
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(connection)}\n`, { encoding: "utf8" });
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporaryPath, paths.metadataPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }
  await assertPrivateDirectory(path);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (uid !== undefined && info.uid !== uid) ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("Local session directory is not owner-only");
  }
}

async function assertPrivateSocket(path: string): Promise<void> {
  const info = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !info.isSocket() ||
    info.isSymbolicLink() ||
    (uid !== undefined && info.uid !== uid) ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("Local session socket is not owner-only");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateConnection(connection: LocalSessionConnection): TeamId {
  if (connection.version !== 1) throw new Error("Unsupported local session version");
  const teamId = parseTeamId(connection.teamId);
  validateCredentialKind(connection.credentialKind);
  if (
    !connection.socketPath.startsWith("/") ||
    connection.capability.length < 16 ||
    !Number.isFinite(Date.parse(connection.createdAt)) ||
    !Number.isFinite(Date.parse(connection.expiresAt))
  ) {
    throw new Error("Invalid local session metadata");
  }
  return teamId;
}

function validateCredentialKind(value: unknown): asserts value is CredentialKind {
  if (value !== "user" && value !== "bot") throw new Error("Invalid credential kind");
}
