import { describe, expect, it, vi } from "vitest";
import { parseTeamId } from "../../domain/team-id.js";
import { WorkspaceRegistry } from "../../workspace/registry.js";
import type { WorkspaceStore } from "../../workspace/store.js";
import type { WorkspaceRegistryDocument } from "../../workspace/types.js";
import { createCliTargetClient } from "../target-client.js";

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

function registry(): WorkspaceRegistry {
  return new WorkspaceRegistry(
    new MemoryStore({
      version: 1,
      defaultTeamId: WEDGE_TEAM,
      workspaces: [
        {
          teamId: WEDGE_TEAM,
          alias: "wedgeai",
          domain: "wedgeai.slack.com",
          previousDomains: ["old-wedgeai.slack.com"],
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

describe("CLI permalink workspace routing", () => {
  it.each(["C0123ABC", "https://wedgeai.slack.com/archives/C0123ABC/p1700000000000001"])(
    "passes the profile after resolving the workspace for %s", async (input) => {
      const base = await registry().resolve("wedgeai");
      const { isDefault: _isDefault, ...record } = base;
      const selected = new WorkspaceRegistry(new MemoryStore({ version: 1, defaultTeamId: WEDGE_TEAM,
        workspaces: [{ ...record, profiles: [{ name: "a", credentialRefs: record.credentialRefs! }] }] }));
      const clientLeaseFactory = vi.fn().mockResolvedValue({ client: {}, dispose() {} });
      await createCliTargetClient({ input, profile: "a", env: {}, registry: selected, clientLeaseFactory });
      expect(clientLeaseFactory).toHaveBeenCalledWith("wedgeai", selected, "a");
    });
  it("rejects an absent profile before creating a permalink client", async () => {
    const clientLeaseFactory = vi.fn();
    await expect(createCliTargetClient({ input: "https://ma-navi.slack.com/archives/C0123ABC/p1700000000000001",
      profile: "b", env: {}, registry: registry(), clientLeaseFactory })).rejects.toThrow(/profile/);
    expect(clientLeaseFactory).not.toHaveBeenCalled();
  });
  it.each([
    {
      explicitWorkspace: "wedgeai",
      env: {},
      input: "https://ma-navi.slack.com/archives/C0123ABC/p1700000000000001",
    },
    {
      explicitWorkspace: undefined,
      env: { SLAMY_DEFAULT_WORKSPACE: "wedgeai" },
      input: "https://ma-navi.slack.com/archives/C0123ABC/p1700000000000001",
    },
    {
      explicitWorkspace: "wedgeai",
      env: {},
      input: "https://app.slack.com/client/TMANAVI01/C0123ABC",
    },
  ])(
    "rejects WedgeAI selection with an M&A Navi permalink before client creation",
    async ({ explicitWorkspace, env, input }) => {
      const clientLeaseFactory = vi.fn();

      await expect(
        createCliTargetClient({
          input,
          explicitWorkspace,
          env,
          registry: registry(),
          clientLeaseFactory,
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
      expect(clientLeaseFactory).not.toHaveBeenCalled();
    },
  );

  it("does not let an empty explicit selector defer to permalink evidence", async () => {
    const clientLeaseFactory = vi.fn();

    await expect(
      createCliTargetClient({
        input: "https://wedgeai.slack.com/archives/C0123ABC/p1700000000000001",
        explicitWorkspace: "",
        env: {},
        registry: registry(),
        clientLeaseFactory,
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_REGISTERED" });
    expect(clientLeaseFactory).not.toHaveBeenCalled();
  });

  it.each([
    "https://wedgeai.slack.com/archives/C0123ABC/p1700000000000001",
    "https://old-wedgeai.slack.com/archives/C0123ABC/p1700000000000001",
  ])("accepts a matching current/previous WedgeAI domain: %s", async (input) => {
    const clientLeaseFactory = vi.fn().mockResolvedValue({
      client: { workspace: "wedgeai" },
      teamId: WEDGE_TEAM,
      dispose: vi.fn(),
    });

    const result = await createCliTargetClient({
      input,
      explicitWorkspace: "wedgeai",
      env: {},
      registry: registry(),
      clientLeaseFactory,
    });

    expect(result.target).toMatchObject({
      channel: "C0123ABC",
      ts: "1700000000.000001",
    });
    expect(clientLeaseFactory).toHaveBeenCalledWith("wedgeai", expect.any(WorkspaceRegistry));
  });

  it("routes a permalink hostname through its registered workspace when legacy selectors are absent", async () => {
    const clientLeaseFactory = vi.fn().mockResolvedValue({
      client: { workspace: "manavi" },
      teamId: MANAVI_TEAM,
      dispose: vi.fn(),
    });

    await createCliTargetClient({
      input: "https://ma-navi.slack.com/archives/C0123ABC/p1700000000000001",
      env: {},
      registry: registry(),
      clientLeaseFactory,
    });

    expect(clientLeaseFactory).toHaveBeenCalledWith("manavi", expect.any(WorkspaceRegistry));
  });

  it("preserves the permalink parent timestamp as the implicit thread target", async () => {
    const clientLeaseFactory = vi.fn().mockResolvedValue({
      client: {},
      teamId: WEDGE_TEAM,
      dispose: vi.fn(),
    });

    const result = await createCliTargetClient({
      input: "https://wedgeai.slack.com/archives/C0123ABC/p1700000000000001",
      explicitWorkspace: "wedgeai",
      env: {},
      registry: registry(),
      clientLeaseFactory,
    });

    expect(result.target).toMatchObject({
      ts: "1700000000.000001",
      thread_ts: "1700000000.000001",
    });
  });

  it.each([
    "https://unknown.slack.com/archives/C0123ABC/p1700000000000001",
    "https://evil.example.com/archives/C0123ABC/p1700000000000001",
  ])("rejects unknown or non-Slack permalink hosts before client creation: %s", async (input) => {
    const clientLeaseFactory = vi.fn();

    await expect(
      createCliTargetClient({
        input,
        env: {},
        registry: registry(),
        clientLeaseFactory,
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/WORKSPACE_NOT_REGISTERED|UNSUPPORTED_URL/),
    });
    expect(clientLeaseFactory).not.toHaveBeenCalled();
  });

  it("preserves legacy single-workspace mode for a non-URL channel ID", async () => {
    const clientLeaseFactory = vi.fn().mockResolvedValue({
      client: { workspace: "legacy" },
      dispose: vi.fn(),
    });

    const result = await createCliTargetClient({
      input: "C0123ABC",
      env: {},
      registry: registry(),
      clientLeaseFactory,
    });

    expect(result.target).toEqual({ channel: "C0123ABC" });
    expect(clientLeaseFactory).toHaveBeenCalledWith(undefined, undefined);
  });
});
