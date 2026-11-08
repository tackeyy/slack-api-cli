import { describe, expect, it } from "vitest";
import { parseTeamId } from "../../domain/team-id.js";
import { WorkspaceRegistry } from "../registry.js";
import type { WorkspaceStore } from "../store.js";
import type { WorkspaceRegistryDocument } from "../types.js";

class MemoryStore implements WorkspaceStore {
  document: WorkspaceRegistryDocument = { version: 1, workspaces: [] };
  writes = 0;

  async read(): Promise<WorkspaceRegistryDocument> {
    return structuredClone(this.document);
  }

  async write(document: WorkspaceRegistryDocument): Promise<void> {
    this.writes += 1;
    this.document = structuredClone(document);
  }

  async update(
    mutate: (document: WorkspaceRegistryDocument) => WorkspaceRegistryDocument,
  ): Promise<WorkspaceRegistryDocument> {
    const next = mutate(structuredClone(this.document));
    await this.write(next);
    return structuredClone(next);
  }
}

class CoordinatedStore extends MemoryStore {
  #reads = 0;
  #releaseReads!: () => void;
  #readBarrier = new Promise<void>((resolve) => {
    this.#releaseReads = resolve;
  });
  #transaction = Promise.resolve();

  override async read(): Promise<WorkspaceRegistryDocument> {
    this.#reads += 1;
    if (this.#reads === 2) this.#releaseReads();
    await this.#readBarrier;
    return super.read();
  }

  async update(
    mutate: (document: WorkspaceRegistryDocument) => WorkspaceRegistryDocument,
  ): Promise<WorkspaceRegistryDocument> {
    const result = this.#transaction.then(async () => {
      const next = mutate(structuredClone(this.document));
      this.document = structuredClone(next);
      this.writes += 1;
      return structuredClone(next);
    });
    this.#transaction = result.then(() => undefined, () => undefined);
    return result;
  }
}

const primary = {
  teamId: parseTeamId("T00000001"),
  alias: "primary",
  domain: "primary.slack.com",
  previousDomains: ["old-primary.slack.com"],
  displayName: "Primary",
};

describe("WorkspaceRegistry", () => {
  it("adds, selects, lists and removes profiles without merging credentials", async () => {
    const store = new MemoryStore();
    const registry = new WorkspaceRegistry(store);
    await registry.add({ ...primary, credentialRefs: { user: { provider: "environment", name: "BASE" } } });
    const refs = { bot: { provider: "environment", name: "APP_B" } };
    await registry.addProfile("primary", "b", refs);
    expect(await registry.listProfiles("primary")).toEqual([{ name: "b", credentialRefs: refs }]);
    expect(await registry.resolve("primary", "b")).toMatchObject({ profile: "b", credentialRefs: refs });
    await expect(registry.addProfile("primary", "b", refs)).rejects.toThrow();
    await expect(registry.resolve("primary", "missing")).rejects.toThrow();
    await registry.removeProfile("primary", "b");
    expect((await registry.resolve("primary")).profiles).toBeUndefined();
    await expect(registry.removeProfile("primary", "b")).rejects.toThrow();
  });
  it("mutates and resolves workspaces by Team ID, alias, domain history, and default", async () => {
    const store = new MemoryStore();
    const registry = new WorkspaceRegistry(store);

    await registry.add(primary, { makeDefault: true });

    for (const selector of [
      "T00000001",
      "primary",
      "primary.slack.com",
      "old-primary.slack.com",
      undefined,
    ]) {
      expect((await registry.resolve(selector)).teamId).toBe("T00000001");
    }
    expect(await registry.list()).toEqual([{ ...primary, isDefault: true }]);

    await registry.clearDefault();
    await expect(registry.resolve()).rejects.toMatchObject({ code: "DEFAULT_NOT_FOUND" });
    await registry.setDefault("primary");
    await registry.remove("old-primary.slack.com");

    expect(await registry.list()).toEqual([]);
    expect(store.document.defaultTeamId).toBeUndefined();
  });

  it("rejects conflicting additions without writing a partial document", async () => {
    const store = new MemoryStore();
    const registry = new WorkspaceRegistry(store);
    await registry.add(primary);
    const writesBeforeConflict = store.writes;

    await expect(
      registry.add({ ...primary, teamId: parseTeamId("T00000002") }),
    ).rejects.toMatchObject({ code: "DUPLICATE_ALIAS" });

    expect(store.writes).toBe(writesBeforeConflict);
    expect(store.document.workspaces).toHaveLength(1);
  });

  it("serializes concurrent mutations without losing a successful update", async () => {
    const store = new CoordinatedStore();
    const first = new WorkspaceRegistry(store);
    const second = new WorkspaceRegistry(store);

    await Promise.all([
      first.add(primary),
      second.add({
        ...primary,
        teamId: parseTeamId("T00000002"),
        alias: "secondary",
        domain: "secondary.slack.com",
        previousDomains: [],
      }),
    ]);

    expect(store.document.workspaces.map((workspace) => workspace.alias).sort()).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("requires a fully-qualified domain so alias and domain labels cannot collide", async () => {
    const store = new MemoryStore();
    const registry = new WorkspaceRegistry(store);
    await registry.add(primary);
    await registry.add({
      ...primary,
      teamId: parseTeamId("T00000002"),
      alias: "secondary",
      domain: "primary-label.slack.com",
      previousDomains: [],
    });

    expect((await registry.resolve("primary")).teamId).toBe("T00000001");
    expect((await registry.resolve("primary-label.slack.com")).teamId).toBe("T00000002");
    await expect(registry.resolve("primary-label")).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });
  });
});
