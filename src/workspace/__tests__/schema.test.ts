import { describe, expect, it } from "vitest";
import { WorkspaceRegistryError } from "../errors.js";
import {
  decodeWorkspaceRegistry,
  parseWorkspaceRegistryJson,
  serializeWorkspaceRegistry,
} from "../schema.js";

describe("decodeWorkspaceRegistry", () => {
  it("round trips named profiles and omits an empty profiles array", () => {
    const base = { teamId: "T00000001", alias: "primary", domain: "primary.slack.com",
      previousDomains: [], displayName: "Primary" };
    const profiles = [{ name: "a", credentialRefs: { user: { provider: "environment", name: "APP_A" } } }];
    const decoded = decodeWorkspaceRegistry({ version: 1, workspaces: [{ ...base, profiles }] });
    expect(parseWorkspaceRegistryJson(serializeWorkspaceRegistry(decoded)).workspaces[0]).toEqual({ ...base, profiles });
    expect(decodeWorkspaceRegistry({ version: 1, workspaces: [{ ...base, profiles: [] }] }).workspaces[0]).toEqual(base);
  });
  it("accepts a version 1 document with Team ID as the canonical identity", () => {
    const document = decodeWorkspaceRegistry({
      version: 1,
      defaultTeamId: "T00000001",
      workspaces: [
        {
          teamId: "T00000001",
          alias: "primary",
          domain: "primary.slack.com",
          previousDomains: ["old-primary.slack.com"],
          displayName: "Primary",
          credentialRefs: {
            user: { provider: "environment", name: "SLAMY_WORKSPACE_PRIMARY_USER_TOKEN" },
          },
        },
      ],
    });

    expect(document.defaultTeamId).toBe("T00000001");
    expect(document.workspaces[0]?.teamId).toBe("T00000001");
  });

  it("accepts opaque references for registered credential providers", () => {
    const document = decodeWorkspaceRegistry({
      version: 1,
      workspaces: [
        {
          teamId: "T00000001",
          alias: "primary",
          domain: "primary.slack.com",
          previousDomains: [],
          displayName: "Primary",
          credentialRefs: {
            user: { provider: "keychain", name: "primary/user" },
          },
        },
      ],
    });

    expect(document.workspaces[0]?.credentialRefs?.user).toEqual({
      provider: "keychain",
      name: "primary/user",
    });
  });

  it("fails closed for corrupt, unknown, duplicate, ambiguous, or secret-like input", () => {
    const workspace = {
      teamId: "T00000001",
      alias: "primary",
      domain: "primary.slack.com",
      previousDomains: ["old-primary.slack.com"],
      displayName: "Primary",
    };
    const profile = { name: "a", credentialRefs: { user: { provider: "environment", name: "APP_A" } } };
    const unsafeDocuments: unknown[] = [
      ...["default", "", "A", "a_b", "../a", "a".repeat(33)].map((name) => ({
        version: 1, workspaces: [{ ...workspace, profiles: [{ ...profile, name }] }],
      })),
      ...[null, {}, [profile, profile], [{ ...profile, unknown: true }],
        [{ name: "a", credentialRefs: {} }],
        [{ name: "a", credentialRefs: { user: { provider: "keychain", name: "item" } } }],
        [{ name: "a", credentialRefs: { user: { provider: "environment", name: "xoxp-profile-canary" } } }],
      ].map((profiles) => ({ version: 1, workspaces: [{ ...workspace, profiles }] })),
      { version: 2, workspaces: [] },
      { version: 1, workspaces: [], unknown: true },
      { version: 1, workspaces: [{ ...workspace, unknown: true }] },
      { version: 1, workspaces: [workspace, { ...workspace, alias: "secondary" }] },
      {
        version: 1,
        workspaces: [workspace, { ...workspace, teamId: "T00000002" }],
      },
      {
        version: 1,
        workspaces: [
          {
            ...workspace,
            credentialRefs: { user: { provider: "Invalid Provider", name: "primary/user" } },
          },
        ],
      },
      {
        version: 1,
        workspaces: [
          workspace,
          {
            ...workspace,
            teamId: "T00000002",
            alias: "secondary",
            domain: "secondary.slack.com",
            previousDomains: ["primary.slack.com"],
          },
        ],
      },
      { version: 1, defaultTeamId: "T99999999", workspaces: [workspace] },
      { version: 1, workspaces: [{ ...workspace, alias: "Primary" }] },
      {
        version: 1,
        workspaces: [
          {
            ...workspace,
            credentialRefs: {
              user: { provider: "environment", name: "xoxp-secret-canary" },
            },
          },
        ],
      },
    ];

    for (const unsafe of unsafeDocuments) {
      expect(() => decodeWorkspaceRegistry(unsafe)).toThrow(WorkspaceRegistryError);
    }
    expect(() => parseWorkspaceRegistryJson("{broken")).toThrow(WorkspaceRegistryError);

    try {
      decodeWorkspaceRegistry(unsafeDocuments.at(-1));
    } catch (error) {
      expect(String(error)).not.toContain("xoxp-secret-canary");
    }
  });

  it.each([
    "xapp-1-A0123456789-secret-canary",
    "https://hooks.slack.com/services/T000/B000/commercial-secret-canary",
    "https://hooks.slack.com/triggers/T000/commercial-trigger-secret-canary",
    "https://hooks.slack.com/actions/T000/commercial-action-secret-canary",
    "https://hooks.slack-gov.com/services/T000/B000/gov-secret-canary",
    "https://hooks.slack-gov.com/triggers/T000/gov-trigger-secret-canary",
    "https://hooks.slack-gov.com/actions/T000/gov-action-secret-canary",
  ])("rejects Slack secrets from custom-provider references", (canary) => {
    const document = {
      version: 1,
      workspaces: [
        {
          teamId: "T00000001",
          alias: "primary",
          domain: "primary.slack.com",
          previousDomains: [],
          displayName: "Primary",
          credentialRefs: { user: { provider: "keychain", name: canary } },
        },
      ],
    };

    for (const action of [
      () => decodeWorkspaceRegistry(document),
      () => serializeWorkspaceRegistry(document as never),
    ]) {
      expect(action).toThrow(WorkspaceRegistryError);
      try {
        action();
      } catch (error) {
        expect(String(error)).not.toContain(canary);
        expect(JSON.stringify(error)).not.toContain(canary);
      }
    }
  });
});
