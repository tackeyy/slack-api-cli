import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeamId } from "../../domain/team-id.js";
import {
  findLocalSessionForWorkspace,
  prepareLocalSessionPaths,
  readLocalSessionConnection,
  resolveLocalSessionPaths,
  writeLocalSessionConnection,
} from "../local-session-files.js";

const tempPaths: string[] = [];
const socketServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    socketServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local session files", () => {
  it("isolates named profile paths while preserving the unnamed paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "sp-"));
    tempPaths.push(root);
    const input = { configHome: root, runtimeRoot: join(root, "run"), teamId: "TPROFILE1", credentialKind: "user" as const };
    const base = resolveLocalSessionPaths(input);
    const a = await prepareLocalSessionPaths({ ...input, profile: "a" });
    const b = resolveLocalSessionPaths({ ...input, credentialKind: "bot", profile: "b" });
    expect(base.sessionDirectory).toBe(join(root, "slamy/sessions/TPROFILE1/user"));
    expect(a.sessionDirectory).toBe(join(root, "slamy/sessions/TPROFILE1/profiles/a/user"));
    expect(a.socketPath).toBe(join(root, "run/TPROFILE1-user-a.sock"));
    expect(new Set([base.socketPath, a.socketPath, b.socketPath]).size).toBe(3);
    for (const profile of ["default", "../a", "", "A", "a".repeat(33)]) {
      expect(() => resolveLocalSessionPaths({ ...input, profile })).toThrow();
    }
  });
  it("creates owner-only directories and metadata without a Slack token", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-files-"));
    tempPaths.push(root);
    const paths = await prepareLocalSessionPaths({
      configHome: root,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
    });
    await writeLocalSessionConnection(paths, {
      version: 1,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
      socketPath: paths.socketPath,
      capability: "local-capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    await listenSocket(paths.socketPath);

    expect((await stat(paths.sessionDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.metadataPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(paths.metadataPath, "utf8")).not.toMatch(/xox[bp]-/);
  });

  it("fails closed when a session path component is a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-symlink-"));
    const redirected = await mkdtemp(join(tmpdir(), "slamy-session-redirected-"));
    tempPaths.push(root, redirected);
    await symlink(redirected, join(root, "slamy"));

    await expect(
      prepareLocalSessionPaths({
        configHome: root,
        teamId: "T0BJ9SG2M0R",
        credentialKind: "user",
      }),
    ).rejects.toThrow("owner-only");
  });

  it("returns an active descriptor and treats an expired descriptor as unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-expiry-"));
    tempPaths.push(root);
    const paths = await prepareLocalSessionPaths({
      configHome: root,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
    });
    await writeLocalSessionConnection(paths, {
      version: 1,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
      socketPath: paths.socketPath,
      capability: "local-capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    await listenSocket(paths.socketPath);

    expect(
      await readLocalSessionConnection(paths, new Date("2029-12-31T23:59:59.000Z")),
    ).toMatchObject({ teamId: "T0BJ9SG2M0R" });
    expect(
      await readLocalSessionConnection(paths, new Date("2030-01-01T00:00:00.000Z")),
    ).toBeUndefined();
  });

  it("finds only the selected workspace's configured credential kind", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-lookup-"));
    tempPaths.push(root);
    const paths = await prepareLocalSessionPaths({
      configHome: root,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
    });
    await writeLocalSessionConnection(paths, {
      version: 1,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
      socketPath: paths.socketPath,
      capability: "local-capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    await listenSocket(paths.socketPath);

    await expect(
      findLocalSessionForWorkspace(
        {
          teamId: parseTeamId("T0BJ9SG2M0R"),
          alias: "wedgeai",
          domain: "wedgeai.slack.com",
          previousDomains: [],
          displayName: "WedgeAI",
          credentialRefs: { user: { provider: "environment", name: "WEDGE_TOKEN" } },
        },
        { XDG_CONFIG_HOME: root },
        new Date("2029-01-01T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ teamId: "T0BJ9SG2M0R", credentialKind: "user" });
  });

  it("cleans active-looking metadata when the in-memory broker socket is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-reboot-"));
    tempPaths.push(root);
    const paths = await prepareLocalSessionPaths({
      configHome: root,
      runtimeRoot: join(root, "runtime"),
      teamId: "T0BJ9SG2M0R",
      credentialKind: "user",
    });
    await writeLocalSessionConnection(paths, {
      version: 1,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user",
      socketPath: paths.socketPath,
      capability: "local-capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });

    await expect(
      readLocalSessionConnection(paths, new Date("2029-01-02T00:00:00.000Z")),
    ).resolves.toBeUndefined();
    await expect(stat(paths.metadataPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for malformed or cross-workspace metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-invalid-"));
    tempPaths.push(root);
    const paths = await prepareLocalSessionPaths({
      configHome: root,
      runtimeRoot: join(root, "runtime"),
      teamId: "T0BJ9SG2M0R",
      credentialKind: "user",
    });

    await writeFile(paths.metadataPath, "not-json\n", { mode: 0o600 });
    await expect(readLocalSessionConnection(paths)).rejects.toThrow("metadata is invalid");
    await writeFile(paths.metadataPath, "[]\n", { mode: 0o600 });
    await expect(readLocalSessionConnection(paths)).rejects.toThrow("metadata is invalid");

    const base = {
      version: 1 as const,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "user" as const,
      socketPath: paths.socketPath,
      capability: "local-capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    for (const connection of [
      { ...base, teamId: parseTeamId("TOTHER001") },
      { ...base, credentialKind: "bot" as const },
      { ...base, socketPath: "/tmp/different.sock" },
    ]) {
      await writeFile(paths.metadataPath, `${JSON.stringify(connection)}\n`, { mode: 0o600 });
      await expect(readLocalSessionConnection(paths)).rejects.toThrow("does not match");
    }
    await writeFile(paths.metadataPath, `${JSON.stringify({ ...base, version: 2 })}\n`, { mode: 0o600 });
    await expect(readLocalSessionConnection(paths)).rejects.toThrow("Unsupported local session version");
    await writeFile(paths.metadataPath, `${JSON.stringify({ ...base, capability: "short" })}\n`, { mode: 0o600 });
    await expect(readLocalSessionConnection(paths)).rejects.toThrow("Invalid local session metadata");
  });

  it("does not select a mixed-credential session and probes bot-only workspaces independently", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-kind-"));
    tempPaths.push(root);
    const baseWorkspace = {
      teamId: parseTeamId("T0BJ9SG2M0R"),
      alias: "wedgeai",
      domain: "wedgeai.slack.com",
      previousDomains: [],
      displayName: "WedgeAI",
    };
    await expect(findLocalSessionForWorkspace({
      ...baseWorkspace,
      credentialRefs: {
        user: { provider: "environment", name: "USER_TOKEN" },
        bot: { provider: "environment", name: "BOT_TOKEN" },
      },
    }, { XDG_CONFIG_HOME: root })).resolves.toBeUndefined();
    await expect(findLocalSessionForWorkspace({
      ...baseWorkspace,
      credentialRefs: { bot: { provider: "environment", name: "BOT_TOKEN" } },
    }, { XDG_CONFIG_HOME: root })).resolves.toBeUndefined();
  });
});

async function listenSocket(path: string): Promise<void> {
  const server = createServer();
  socketServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
}
