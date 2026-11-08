import * as sessionFiles from "../local-session-files.js";
import * as sessionBroker from "../local-session-broker.js";
import type { LocalSessionConnection } from "../local-session-web-client.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeamId } from "../../domain/team-id.js";
import {
  getLocalSessionStatus,
  publicStatus,
  revokeLocalSession,
  startLocalSession,
  startLocalSessionForeground,
} from "../local-session-service.js";

const userWorkspace = {
  teamId: parseTeamId("T0BJ9SG2M0R"),
  alias: "wedgeai",
  domain: "wedgeai.slack.com",
  previousDomains: [],
  displayName: "WedgeAI",
  credentialRefs: { user: { provider: "environment" as const, name: "WEDGE_TOKEN" } },
};

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local session service", () => {
  it("keeps unnamed, user profile and bot profile sessions independent on revoke and expiry", async () => {
    const root = await mkdtemp(join(tmpdir(), "sp-multi-"));
    tempPaths.push(root);
    const teamId = parseTeamId("TP" + root.slice(-6).toUpperCase());
    const now = new Date("2029-01-01");
    const workspaces = [
      { ...userWorkspace, teamId },
      { ...userWorkspace, teamId, profile: "a" },
      { ...userWorkspace, teamId, profile: "b", credentialRefs: { bot: { provider: "environment", name: "APP_B" } } },
    ];
    const sessions = new Map<string, LocalSessionConnection>();
    const read = vi.spyOn(sessionFiles, "readLocalSessionConnection").mockImplementation(async (paths, time = now) => {
      const connection = sessions.get(paths.socketPath);
      if (connection && Date.parse(connection.expiresAt) <= time.getTime()) {
        sessions.delete(paths.socketPath);
        return undefined;
      }
      return connection;
    });
    const revoke = vi.spyOn(sessionBroker, "revokeLocalSessionBroker").mockImplementation(async (connection) => {
      sessions.delete(connection.socketPath);
    });
    try {
      for (const workspace of workspaces) {
        const bot = "bot" in workspace.credentialRefs;
        await startLocalSession({ workspace, token: bot ? "xoxb-fixture" : "xoxp-fixture", ttlMs: 10000,
          configHome: root, cliPath: "/fixture/cli", executablePath: "/fixture/node" }, {
          now: () => now, capability: () => "fixture-capability-canary",
          verify: vi.fn().mockResolvedValue({ teamId, userId: "U1", ...(bot ? { botId: "B1" } : {}) }),
          launch: async (input) => {
            sessions.set(input.connection.socketPath, input.connection);
            return { pid: 1 };
          },
        });
      }
      for (const workspace of workspaces) expect(await getLocalSessionStatus(workspace, root, now)).toBeDefined();
      expect(await revokeLocalSession(workspaces[1]!, root, now)).toBe(true);
      expect(await getLocalSessionStatus(workspaces[1]!, root, now)).toBeUndefined();
      expect(await getLocalSessionStatus(workspaces[0]!, root, now)).toBeDefined();
      expect(await getLocalSessionStatus(workspaces[2]!, root, new Date(now.getTime() + 10000))).toBeUndefined();
      expect(await getLocalSessionStatus(workspaces[0]!, root, now)).toBeDefined();
    } finally { read.mockRestore(); revoke.mockRestore(); }
  });
  it("starts a named session with a distinct socket and public profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "sp-service-"));
    tempPaths.push(root);
    const launch = vi.fn().mockResolvedValue(undefined);
    const result = await startLocalSession({ workspace: { ...userWorkspace, profile: "a" },
      token: "xoxp-fixture-only", ttlMs: 1000, configHome: root, cliPath: "/fixture/cli", executablePath: "/fixture/node" }, {
      verify: vi.fn().mockResolvedValue({ teamId: userWorkspace.teamId, userId: "U1" }), launch,
      now: () => new Date("2029-01-01"), capability: () => "fixture-capability-canary" });
    expect(result).toMatchObject({ profile: "a" });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ profile: "a", connection: expect.objectContaining({
      socketPath: expect.stringContaining("-user-a.sock") }) }));
  });
  it("rejects a token from another Team ID before launching a daemon and redacts errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-service-"));
    tempPaths.push(root);
    const launch = vi.fn();
    const token = "xoxp-cross-team-secret-canary";

    await expect(
      startLocalSession(
        {
          workspace: {
            teamId: parseTeamId("T0BJ9SG2M0R"),
            alias: "wedgeai",
            domain: "wedgeai.slack.com",
            previousDomains: [],
            displayName: "WedgeAI",
            credentialRefs: { user: { provider: "environment", name: "WEDGE_TOKEN" } },
          },
          token,
          ttlMs: 24 * 60 * 60 * 1000,
          configHome: root,
          cliPath: "/opt/slamy/dist/cli/index.js",
          executablePath: "/opt/node/bin/node",
        },
        {
          verify: vi.fn().mockResolvedValue({
            teamId: parseTeamId("TOTHER001"),
            userId: "U1",
          }),
          launch,
          now: () => new Date("2029-01-01T00:00:00.000Z"),
          capability: () => "local-capability-canary",
        },
      ),
    ).rejects.not.toThrow(token);
    expect(launch).not.toHaveBeenCalled();
  });

  it("rejects Enterprise org tokens whose access can span workspaces", async () => {
    const launch = vi.fn();
    const token = "xoxe.xoxp-org-secret-canary";
    await expect(
      startLocalSession(
        {
          workspace: {
            teamId: parseTeamId("T0BJ9SG2M0R"),
            alias: "wedgeai",
            domain: "wedgeai.slack.com",
            previousDomains: [],
            displayName: "WedgeAI",
            credentialRefs: { user: { provider: "environment", name: "WEDGE_TOKEN" } },
          },
          token,
          ttlMs: 86_400_000,
          configHome: "/private/config",
          cliPath: "/opt/slamy/dist/cli/index.js",
          executablePath: "/opt/node/bin/node",
        },
        {
          verify: vi.fn().mockResolvedValue({
            teamId: parseTeamId("T0BJ9SG2M0R"),
            userId: "U1",
          }),
          launch,
          now: () => new Date("2029-01-01T00:00:00.000Z"),
          capability: () => "local-capability-canary",
        },
      ),
    ).rejects.toThrow("Enterprise org tokens");
    expect(launch).not.toHaveBeenCalled();
  });

  it("verifies, launches, and returns only public status for a matching user token", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-service-"));
    tempPaths.push(root);
    const verify = vi.fn().mockResolvedValue({
      teamId: parseTeamId("T0BJ9SG2M0R"),
      userId: "U1",
    });
    const launch = vi.fn().mockResolvedValue(undefined);

    const result = await startLocalSession(
      {
        workspace: userWorkspace,
        token: "xoxp-user-secret-canary",
        ttlMs: 86_400_000,
        configHome: root,
        cliPath: "/opt/slamy/dist/cli/index.js",
        executablePath: "/opt/node/bin/node",
      },
      {
        verify,
        launch,
        now: () => new Date("2029-01-01T00:00:00.000Z"),
        capability: () => "local-capability-canary",
      },
    );

    expect(result).toEqual({
      workspace: "wedgeai",
      teamId: "T0BJ9SG2M0R",
      credentialKind: "user",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2029-01-02T00:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("capability");
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      token: "xoxp-user-secret-canary",
      connection: expect.objectContaining({ capability: "local-capability-canary" }),
    }));
  });

  it.each([0, -1, 604_800_001, 1.5, Number.NaN])("rejects invalid TTL %s", async (ttlMs) => {
    await expect(startLocalSession({
      workspace: userWorkspace,
      token: "xoxp-user-secret-canary",
      ttlMs,
      configHome: "/private/config",
      cliPath: "/opt/slamy/dist/cli/index.js",
      executablePath: "/opt/node/bin/node",
    })).rejects.toThrow("between 1 millisecond and 7 days");
  });

  it("normalizes verifier failures and rejects a bot-shaped identity for a user session", async () => {
    const input = {
      workspace: userWorkspace,
      token: "xoxp-user-secret-canary",
      ttlMs: 86_400_000,
      configHome: "/private/config",
      cliPath: "/opt/slamy/dist/cli/index.js",
      executablePath: "/opt/node/bin/node",
    };
    await expect(startLocalSession(input, {
      verify: vi.fn().mockRejectedValue(new Error("secret upstream detail")),
      launch: vi.fn(),
      now: () => new Date(),
      capability: () => "capability",
    })).rejects.toThrow("identity verification failed");
    await expect(startLocalSession(input, {
      verify: vi.fn().mockResolvedValue({
        teamId: parseTeamId("T0BJ9SG2M0R"),
        userId: "U1",
        botId: "B1",
      }),
      launch: vi.fn(),
      now: () => new Date(),
      capability: () => "capability",
    })).rejects.toThrow("does not match");
  });

  it("publishes bot status without connection secrets", () => {
    const status = publicStatus({
      ...userWorkspace,
      credentialRefs: { bot: { provider: "environment", name: "BOT_TOKEN" } },
    }, {
      version: 1,
      teamId: parseTeamId("T0BJ9SG2M0R"),
      credentialKind: "bot",
      socketPath: "/private/session.sock",
      capability: "capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2029-01-02T00:00:00.000Z",
    });
    expect(status).toEqual(expect.objectContaining({ credentialKind: "bot" }));
    expect(JSON.stringify(status)).not.toContain("capability-canary");
  });

  it("returns inactive status and revoke results for isolated user and bot stores", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-inactive-"));
    tempPaths.push(root);
    await expect(getLocalSessionStatus(userWorkspace, root)).resolves.toBeUndefined();
    await expect(revokeLocalSession({
      ...userWorkspace,
      credentialRefs: { bot: { provider: "environment", name: "BOT_TOKEN" } },
    }, root)).resolves.toBe(false);
  });

  it("starts a matching bot session and rejects a user-shaped identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-bot-"));
    tempPaths.push(root);
    const botWorkspace = {
      ...userWorkspace,
      credentialRefs: { bot: { provider: "environment" as const, name: "BOT_TOKEN" } },
    };
    const input = {
      workspace: botWorkspace,
      token: "xoxb-bot-secret-canary",
      ttlMs: 86_400_000,
      configHome: root,
      cliPath: "/opt/slamy/dist/cli/index.js",
      executablePath: "/opt/node/bin/node",
    };
    await expect(startLocalSession(input, {
      verify: vi.fn().mockResolvedValue({
        teamId: parseTeamId("T0BJ9SG2M0R"),
        userId: "U1",
        botId: "B1",
      }),
      launch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2029-01-01T00:00:00.000Z"),
      capability: () => "local-capability-canary",
    })).resolves.toMatchObject({ credentialKind: "bot" });
    await expect(startLocalSession(input, {
      verify: vi.fn().mockResolvedValue({
        teamId: parseTeamId("T0BJ9SG2M0R"),
        userId: "U1",
      }),
      launch: vi.fn(),
      now: () => new Date("2029-01-01T00:00:00.000Z"),
      capability: () => "local-capability-canary",
    })).rejects.toThrow("does not match");
  });

  it.each([undefined, "a"])("passes profile %s to the in-process daemon for supervisor-managed sessions", async (profile) => {
    const root = await mkdtemp(join(tmpdir(), "slamy-session-foreground-"));
    tempPaths.push(root);
    const runDaemon = vi.fn().mockResolvedValue(undefined);

    const result = await startLocalSessionForeground({
      workspace: { ...userWorkspace, ...(profile === undefined ? {} : { profile }) },
      token: "xoxp-user-secret-canary",
      ttlMs: 86_400_000,
      configHome: root,
      cliPath: "/unused/in/foreground.js",
      executablePath: "/unused/node",
    }, {
      verify: vi.fn().mockResolvedValue({
        teamId: parseTeamId("T0BJ9SG2M0R"),
        userId: "U1",
      }),
      now: () => new Date("2029-01-01T00:00:00.000Z"),
      capability: () => "local-capability-canary",
      runDaemon,
    });

    expect(result).toMatchObject({
      workspace: "wedgeai",
      teamId: "T0BJ9SG2M0R",
      credentialKind: "user",
      expiresAt: "2029-01-02T00:00:00.000Z",
    });
    expect(runDaemon.mock.calls[0]?.[0].profile).toBe(profile);
    expect(Object.hasOwn(runDaemon.mock.calls[0]?.[0], "profile")).toBe(profile !== undefined);
    expect(runDaemon).toHaveBeenCalledWith(expect.objectContaining({
      token: "xoxp-user-secret-canary",
      configHome: root,
      connection: expect.objectContaining({ capability: "local-capability-canary" }),
    }));
  });

  it("rejects mixed User and Bot credential workspaces instead of reusing one token for both", async () => {
    const launch = vi.fn();
    await expect(
      startLocalSession(
        {
          workspace: {
            teamId: parseTeamId("T0BJ9SG2M0R"),
            alias: "wedgeai",
            domain: "wedgeai.slack.com",
            previousDomains: [],
            displayName: "WedgeAI",
            credentialRefs: {
              user: { provider: "environment", name: "WEDGE_USER_TOKEN" },
              bot: { provider: "environment", name: "WEDGE_BOT_TOKEN" },
            },
          },
          token: "xoxp-user-secret-canary",
          ttlMs: 86_400_000,
          configHome: "/private/config",
          cliPath: "/opt/slamy/dist/cli/index.js",
          executablePath: "/opt/node/bin/node",
        },
        {
          verify: vi.fn(),
          launch,
          now: () => new Date("2029-01-01T00:00:00.000Z"),
          capability: () => "local-capability-canary",
        },
      ),
    ).rejects.toThrow("exactly one credential kind");
    expect(launch).not.toHaveBeenCalled();
  });
});
