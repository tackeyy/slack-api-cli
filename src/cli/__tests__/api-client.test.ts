import { describe, expect, it, vi } from "vitest";
import type { AuthIdentity, AuthVerifier } from "../../credentials/auth-verifier.js";
import { CredentialResolver } from "../../credentials/resolver.js";
import { EnvironmentCredentialProvider } from "../../credentials/environment-credential-provider.js";
import type { CredentialHandle } from "../../credentials/auth-verifier.js";
import { parseTeamId } from "../../domain/team-id.js";
import { WorkspaceRegistry } from "../../workspace/registry.js";
import type { WorkspaceStore } from "../../workspace/store.js";
import type { WorkspaceRegistryDocument } from "../../workspace/types.js";
import {
  collectCliWorkspaceSelector,
  collectCliProfileSelector,
  createCliApiClient,
  resolveCliWorkspaceSelector,
} from "../api-client.js";

const WEDGE_TEAM = parseTeamId("TWEDGE001");
const MANAVI_TEAM = parseTeamId("TMANAVI01");

class MemoryStore implements WorkspaceStore {
  constructor(readonly document: WorkspaceRegistryDocument) {}

  read(): Promise<WorkspaceRegistryDocument> {
    return Promise.resolve(structuredClone(this.document));
  }

  write(): Promise<void> {
    throw new Error("not used");
  }

  update(): Promise<WorkspaceRegistryDocument> {
    throw new Error("not used");
  }
}

class TokenIdentityVerifier implements AuthVerifier {
  constructor(private readonly identities: Readonly<Record<string, AuthIdentity>>) {}

  verify(secret: CredentialHandle): Promise<AuthIdentity> {
    return Promise.resolve(
      secret.use((token) => {
        const identity = this.identities[token];
        if (!identity) throw new Error("unknown test credential");
        return identity;
      }),
    );
  }
}

function registry(withDefault = true): WorkspaceRegistry {
  return new WorkspaceRegistry(
    new MemoryStore({
      version: 1,
      ...(withDefault ? { defaultTeamId: MANAVI_TEAM } : {}),
      workspaces: [
        {
          teamId: WEDGE_TEAM,
          alias: "wedgeai",
          domain: "wedgeai.slack.com",
          previousDomains: ["wedge-ai.slack.com"],
          displayName: "WedgeAI",
          credentialRefs: {
            user: { provider: "environment", name: "WEDGE_USER_TOKEN" },
          },
        },
        {
          teamId: MANAVI_TEAM,
          alias: "manavi",
          domain: "ma-navi.slack.com",
          previousDomains: [],
          displayName: "M&A Navi",
          credentialRefs: {
            user: { provider: "environment", name: "MANAVI_USER_TOKEN" },
          },
        },
      ],
    }),
  );
}

function corruptRegistry(): WorkspaceRegistry {
  return new WorkspaceRegistry(
    new MemoryStore({
      version: 1,
      defaultTeamId: MANAVI_TEAM,
      workspaces: [
        {
          teamId: WEDGE_TEAM,
          alias: "duplicate",
          domain: "wedgeai.slack.com",
          previousDomains: [],
          displayName: "WedgeAI",
        },
        {
          teamId: MANAVI_TEAM,
          alias: "duplicate",
          domain: "ma-navi.slack.com",
          previousDomains: [],
          displayName: "M&A Navi",
        },
      ],
    }),
  );
}

function resolver(
  env: NodeJS.ProcessEnv,
  identities: Readonly<Record<string, AuthIdentity>>,
): CredentialResolver {
  return new CredentialResolver(
    [new EnvironmentCredentialProvider(env)],
    new TokenIdentityVerifier(identities),
  );
}

describe("CLI workspace API client", () => {
  it.each(["wedgeai", WEDGE_TEAM, "wedgeai.slack.com", "wedge-ai.slack.com"])(
    "root selector %s resolves WedgeAI and never uses M&A Navi or legacy credentials",
    async (selector) => {
      const env = {
        SLAMY_DEFAULT_WORKSPACE: "manavi",
        WEDGE_USER_TOKEN: "xoxp-wedge-test",
        MANAVI_USER_TOKEN: "xoxp-manavi-test",
        SLACK_USER_TOKEN: "xoxp-legacy-manavi-test",
      };
      const clientFactory = vi.fn().mockReturnValue({ workspace: "wedgeai" });

      const lease = await createCliApiClient({
        explicitWorkspace: selector,
        env,
        registry: registry(),
        credentialResolver: resolver(env, {
          "xoxp-wedge-test": { teamId: WEDGE_TEAM, userId: "UWEDGE" },
          "xoxp-manavi-test": { teamId: MANAVI_TEAM, userId: "UMANAVI" },
        }),
        clientFactory,
      });

      expect(lease.teamId).toBe(WEDGE_TEAM);
      expect(clientFactory).toHaveBeenCalledWith({ userToken: "xoxp-wedge-test" });
      expect(JSON.stringify(clientFactory.mock.calls)).not.toContain("manavi-test");
      expect(JSON.stringify(clientFactory.mock.calls)).not.toContain("legacy");
      lease.dispose();
    },
  );

  it("SLAMY_DEFAULT_WORKSPACE uses the same Team ID/domain/alias registry resolver", async () => {
    const env = {
      SLAMY_DEFAULT_WORKSPACE: "wedge-ai.slack.com",
      WEDGE_USER_TOKEN: "xoxp-wedge-test",
    };
    const clientFactory = vi.fn().mockReturnValue({});

    const lease = await createCliApiClient({
      env,
      registry: registry(),
      credentialResolver: resolver(env, {
        "xoxp-wedge-test": { teamId: WEDGE_TEAM, userId: "UWEDGE" },
      }),
      clientFactory,
    });

    expect(lease.teamId).toBe(WEDGE_TEAM);
    expect(clientFactory).toHaveBeenCalledWith({ userToken: "xoxp-wedge-test" });
    lease.dispose();
  });

  it("uses the registry default when no selector is provided", async () => {
    const env = {
      MANAVI_USER_TOKEN: "xoxp-manavi-test",
      SLACK_USER_TOKEN: "xoxp-legacy-test",
    };
    const clientFactory = vi.fn().mockReturnValue({ workspace: "manavi" });

    const lease = await createCliApiClient({
      env,
      registry: registry(),
      credentialResolver: resolver(env, {
        "xoxp-manavi-test": { teamId: MANAVI_TEAM, userId: "UMANAVI" },
      }),
      clientFactory,
    });

    expect(lease.teamId).toBe(MANAVI_TEAM);
    expect(clientFactory).toHaveBeenCalledWith({ userToken: "xoxp-manavi-test" });
    expect(JSON.stringify(clientFactory.mock.calls)).not.toContain("legacy");
    lease.dispose();
  });

  it("propagates registry corruption without falling back to legacy credentials", async () => {
    const clientFactory = vi.fn();

    await expect(
      createCliApiClient({
        env: { SLACK_USER_TOKEN: "xoxp-legacy-test" },
        registry: corruptRegistry(),
        credentialResolver: resolver({}, {}),
        clientFactory,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_ALIAS" });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("selected workspace missing credential fails without legacy fallback", async () => {
    const env = {
      SLAMY_DEFAULT_WORKSPACE: "wedgeai",
      MANAVI_USER_TOKEN: "xoxp-manavi-test",
      SLACK_USER_TOKEN: "xoxp-legacy-manavi-test",
    };
    const clientFactory = vi.fn();

    await expect(
      createCliApiClient({
        env,
        registry: registry(),
        credentialResolver: resolver(env, {}),
        clientFactory,
      }),
    ).rejects.toMatchObject({ code: "CONFIGURED_CREDENTIAL_MISSING" });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("uses an active team-bound local session before reading environment credentials", async () => {
    const clientFactory = vi.fn().mockReturnValue({ workspace: "wedgeai-session" });
    const localSession = {
      version: 1 as const,
      teamId: WEDGE_TEAM,
      credentialKind: "user" as const,
      socketPath: "/private/session.sock",
      capability: "local-capability-canary",
      createdAt: "2029-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };

    const lease = await createCliApiClient({
      explicitWorkspace: "wedgeai",
      env: {},
      registry: registry(),
      credentialResolver: resolver({}, {}),
      localSessionLookup: vi.fn().mockResolvedValue(localSession),
      clientFactory,
    });

    expect(lease.teamId).toBe(WEDGE_TEAM);
    expect(clientFactory).toHaveBeenCalledWith({ localSession });
  });

  it("selected WedgeAI auth.test identity mismatch fails before an API client is created", async () => {
    const env = {
      WEDGE_USER_TOKEN: "xoxp-wedge-label-but-manavi-identity",
      SLACK_USER_TOKEN: "xoxp-legacy-manavi-test",
    };
    const clientFactory = vi.fn();

    await expect(
      createCliApiClient({
        explicitWorkspace: "wedgeai",
        env,
        registry: registry(),
        credentialResolver: resolver(env, {
          "xoxp-wedge-label-but-manavi-identity": {
            teamId: MANAVI_TEAM,
            userId: "UMANAVI",
          },
        }),
        clientFactory,
      }),
    ).rejects.toMatchObject({ code: "TEAM_ID_MISMATCH" });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("legacy single-workspace mode remains available only without a selector", async () => {
    const clientFactory = vi.fn().mockReturnValue({});
    const lease = await createCliApiClient({
      env: { SLACK_USER_TOKEN: "xoxp-legacy-test" },
      registry: registry(false),
      credentialResolver: resolver({}, {}),
      clientFactory,
    });

    expect(lease.teamId).toBeUndefined();
    expect(clientFactory).toHaveBeenCalledWith({ userToken: "xoxp-legacy-test" });
    lease.dispose();
  });
});

describe("resolveCliWorkspaceSelector", () => {
  it("explicit root selector wins over SLAMY_DEFAULT_WORKSPACE", () => {
    expect(
      resolveCliWorkspaceSelector("wedgeai", {
        SLAMY_DEFAULT_WORKSPACE: "manavi",
      }),
    ).toBe("wedgeai");
  });
});

describe("collectCliWorkspaceSelector", () => {
  it("fails closed when one invocation supplies conflicting root selectors", () => {
    expect(() => collectCliWorkspaceSelector("manavi", "wedgeai")).toThrow(
      "Conflicting --workspace selectors",
    );
  });
});

describe("createCliApiClient — self-documenting auth error (no selector, no legacy token)", () => {
  it("throws with auth session start guidance when registry is empty", async () => {
    const emptyRegistry = new WorkspaceRegistry(
      new MemoryStore({ version: 1, workspaces: [] }),
    );
    await expect(
      createCliApiClient({
        env: {},
        registry: emptyRegistry,
        credentialResolver: resolver({}, {}),
        clientFactory: vi.fn(),
      }),
    ).rejects.toThrow(/auth session start/);
  });

  it("throws with auth session start guidance when registry has entries and no legacy token", async () => {
    const clientFactory = vi.fn();
    await expect(
      createCliApiClient({
        env: {},
        registry: registry(false),
        credentialResolver: resolver({}, {}),
        clientFactory,
      }),
    ).rejects.toThrow(/auth session start/);
  });

  it("guidance includes registered workspace aliases when registry has entries", async () => {
    const clientFactory = vi.fn();
    let thrownError: Error | undefined;
    try {
      await createCliApiClient({
        env: {},
        registry: registry(false),
        credentialResolver: resolver({}, {}),
        clientFactory,
      });
    } catch (err) {
      thrownError = err as Error;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toContain("wedgeai");
    expect(thrownError!.message).toContain("manavi");
  });

  it("guidance mentions workspace add when registry is empty", async () => {
    const emptyRegistry = new WorkspaceRegistry(
      new MemoryStore({ version: 1, workspaces: [] }),
    );
    let thrownError: Error | undefined;
    try {
      await createCliApiClient({
        env: {},
        registry: emptyRegistry,
        credentialResolver: resolver({}, {}),
        clientFactory: vi.fn(),
      });
    } catch (err) {
      thrownError = err as Error;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toContain("workspace add");
  });

  it("does not throw when legacy tokens are present (legacy mode)", async () => {
    let thrownError: Error | undefined;
    try {
      await createCliApiClient({
        env: { SLACK_USER_TOKEN: "xoxp-secret-value", SLACK_BOT_TOKEN: "xoxb-secret-value" },
        registry: registry(false),
        credentialResolver: resolver({}, {}),
        clientFactory: vi.fn(),
      });
    } catch (err) {
      thrownError = err as Error;
    }
    // selector が undefined かつ legacy token がある場合はエラーにならない（legacy mode）
    // このテストではエラーが出ないことを確認する
    expect(thrownError).toBeUndefined();
  });

  it("guidance mentions legacy env vars as deprecated (no selector, no legacy token)", async () => {
    const emptyRegistry = new WorkspaceRegistry(
      new MemoryStore({ version: 1, workspaces: [] }),
    );
    let thrownError: Error | undefined;
    try {
      await createCliApiClient({
        env: {},
        registry: emptyRegistry,
        credentialResolver: resolver({}, {}),
        clientFactory: vi.fn(),
      });
    } catch (err) {
      thrownError = err as Error;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError!.message.toLowerCase()).toMatch(/deprecated/);
  });
});

describe("profile selection", () => {
  it("rejects conflicting and invalid profile flags without including their values", () => {
    expect(collectCliProfileSelector("a", "a")).toBe("a");
    expect(() => collectCliProfileSelector("b", "a")).toThrow("Conflicting --profile");
    for (const name of ["default", "A", "../a", "", "a".repeat(33), "xoxp-secret-canary"]) {
      expect(() => collectCliProfileSelector(name, undefined)).toThrow();
      try { collectCliProfileSelector(name, undefined); } catch (error) {
        expect(String(error)).not.toContain(name || "empty-name-canary");
      }
    }
  });
  it("uses only the selected profile for session lookup and resolver", async () => {
    const selectedRegistry = registry();
    const base = await selectedRegistry.resolve("wedgeai");
    const refs = { bot: { provider: "environment", name: "APP_B" } };
    // Registry documents contain records, not views.
    const record = { ...base, profiles: [{ name: "b", credentialRefs: refs }] };
    delete (record as Partial<typeof base>).isDefault;
    const cleanRegistry = new WorkspaceRegistry(new MemoryStore({ version: 1, defaultTeamId: WEDGE_TEAM, workspaces: [record] }));
    const lookup = vi.fn().mockResolvedValue({ teamId: WEDGE_TEAM, credentialKind: "bot", socketPath: "/fixture/b.sock" });
    const factory = vi.fn();
    await createCliApiClient({ profile: "b", registry: cleanRegistry, env: {}, localSessionLookup: lookup, clientFactory: factory });
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ profile: "b", credentialRefs: refs }));
    expect(factory).toHaveBeenCalledWith({ localSession: expect.objectContaining({ credentialKind: "bot" }) });
    const resolveForWorkspace = vi.fn().mockRejectedValue(new Error("fixture stop"));
    await expect(createCliApiClient({ profile: "b", registry: cleanRegistry, env: {},
      localSessionLookup: async () => undefined, credentialResolver: { resolveForWorkspace } as never,
      clientFactory: factory })).rejects.toThrow("fixture stop");
    expect(resolveForWorkspace).toHaveBeenCalledWith(expect.objectContaining({ profile: "b", credentialRefs: refs }),
      { requiredKinds: ["bot"], operation: "cli" });
    await expect(createCliApiClient({ profile: "missing", registry: cleanRegistry, env: {}, clientFactory: factory })).rejects.toThrow();
    await expect(createCliApiClient({ profile: "b", registry: registry(false), env: { SLACK_USER_TOKEN: "fixture" }, clientFactory: factory })).rejects.toThrow("A registered workspace is required for --profile");
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("root CLI profile wiring", () => {
  it("rejects profiles on out-of-scope channel management paths before their action", async () => {
    const argv = process.argv;
    const action = vi.fn();
    try {
      vi.resetModules();
      vi.doMock("../channels.js", () => ({ registerChannelManagementCommands: (channels: import("commander").Command) => {
        channels.command("info <input>").action(action);
      } }));
      process.argv = ["node", "slamy", "--workspace", "wedgeai", "--profile", "a", "channels", "info", "C0123ABC"];
      await expect(import("../index.js")).rejects.toThrow(/profile.*not supported/i);
      expect(action).not.toHaveBeenCalled();
    } finally { process.argv = argv; vi.doUnmock("../channels.js"); vi.resetModules(); }
  });
  it.each([
    ["auth", "test"],
    ["messages", "post", "C0123ABC", "--text", "fixture"],
    ["assistant", "set-status", "--channel", "C0123ABC", "--thread", "1700000000.000001", "--status", "fixture"],
  ])("passes the root profile through %j", async (...args) => {
    const argv = process.argv;
    const write = vi.spyOn(console, "log").mockImplementation(() => {});
    const factory = vi.fn().mockResolvedValue({ client: {
      authTest: vi.fn().mockResolvedValue({}),
      postMessage: vi.fn().mockResolvedValue({}),
      setAssistantStatus: vi.fn().mockResolvedValue(undefined),
    }, dispose() {} });
    try {
      vi.resetModules();
      vi.doMock("../api-client.js", async () => ({
        ...await vi.importActual<typeof import("../api-client.js")>("../api-client.js"), createCliApiClient: factory,
      }));
      process.argv = ["node", "slamy", "--workspace", "wedgeai", "--profile", "a", "--json", ...args];
      await import("../index.js");
      expect(factory).toHaveBeenCalledWith({ explicitWorkspace: "wedgeai", profile: "a" });
    } finally {
      process.argv = argv;
      write.mockRestore();
      vi.doUnmock("../api-client.js");
      vi.resetModules();
    }
  });
});
