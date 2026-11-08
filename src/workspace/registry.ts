import { WorkspaceRegistryError } from "./errors.js";
import { decodeWorkspaceRegistry, normalizeWorkspaceDomain, validateWorkspaceProfile } from "./schema.js";
import type { WorkspaceStore } from "./store.js";
import type { WorkspaceView } from "../domain/workspace.js";
import type { WorkspaceCredentialRefs, WorkspaceRecord, WorkspaceRegistryDocument } from "./types.js";

export class WorkspaceRegistry {
  readonly #store: WorkspaceStore;

  constructor(store: WorkspaceStore) {
    this.#store = store;
  }

  async list(): Promise<WorkspaceView[]> {
    const document = await this.#read();
    return document.workspaces.map((workspace) => ({
      ...workspace,
      isDefault: workspace.teamId === document.defaultTeamId,
    }));
  }

  async resolve(selector?: string, profile?: string): Promise<WorkspaceView> {
    const document = await this.#read();
    const workspace = resolveRecord(document, selector);
    const view = { ...workspace, isDefault: workspace.teamId === document.defaultTeamId };
    if (profile === undefined) return view;
    validateWorkspaceProfile(profile);
    const selected = workspace.profiles?.find((item) => item.name === profile);
    if (!selected) throw new WorkspaceRegistryError("WORKSPACE_NOT_FOUND", "Workspace profile not found");
    return { ...view, profile, credentialRefs: selected.credentialRefs };
  }

  async listProfiles(selector: string): Promise<NonNullable<WorkspaceRecord["profiles"]>> {
    return (await this.resolve(selector)).profiles ?? [];
  }

  async addProfile(selector: string, name: string, credentialRefs: WorkspaceCredentialRefs): Promise<WorkspaceView> {
    validateWorkspaceProfile(name);
    await this.#mutate((document) => {
      const workspace = resolveRecord(document, selector);
      workspace.profiles = [...(workspace.profiles ?? []), { name, credentialRefs }];
      return document;
    });
    return this.resolve(selector);
  }

  async removeProfile(selector: string, name: string): Promise<WorkspaceView> {
    validateWorkspaceProfile(name);
    await this.#mutate((document) => {
      const workspace = resolveRecord(document, selector);
      if (!workspace.profiles?.some((item) => item.name === name)) {
        throw new WorkspaceRegistryError("WORKSPACE_NOT_FOUND", "Workspace profile not found");
      }
      workspace.profiles = workspace.profiles.filter((item) => item.name !== name);
      return document;
    });
    return this.resolve(selector);
  }

  async add(record: WorkspaceRecord, options: { makeDefault?: boolean } = {}): Promise<WorkspaceView> {
    const next = await this.#mutate((document) => ({
      ...document,
      ...(options.makeDefault ? { defaultTeamId: record.teamId } : {}),
      workspaces: [...document.workspaces, record],
    }));
    const added = next.workspaces.find((workspace) => workspace.teamId === record.teamId);
    if (!added) throw new WorkspaceRegistryError("STORE_WRITE_FAILED", "Workspace was not added");
    return { ...added, isDefault: added.teamId === next.defaultTeamId };
  }

  async remove(selector: string): Promise<WorkspaceView> {
    let removed: WorkspaceRecord | undefined;
    const next = await this.#mutate((document) => {
      removed = resolveRecord(document, selector);
      return {
        version: 1,
        ...(document.defaultTeamId === removed.teamId
          ? {}
          : document.defaultTeamId === undefined
            ? {}
            : { defaultTeamId: document.defaultTeamId }),
        workspaces: document.workspaces.filter((workspace) => workspace.teamId !== removed?.teamId),
      };
    });
    if (!removed) throw new WorkspaceRegistryError("WORKSPACE_NOT_FOUND", "Workspace not found");
    return { ...removed, isDefault: removed.teamId === next.defaultTeamId };
  }

  async setDefault(selector: string): Promise<WorkspaceView> {
    let selected: WorkspaceRecord | undefined;
    const next = await this.#mutate((document) => {
      selected = resolveRecord(document, selector);
      return { ...document, defaultTeamId: selected.teamId };
    });
    if (!selected) throw new WorkspaceRegistryError("WORKSPACE_NOT_FOUND", "Workspace not found");
    return { ...selected, isDefault: selected.teamId === next.defaultTeamId };
  }

  async clearDefault(): Promise<void> {
    await this.#mutate((document) => ({ version: 1, workspaces: document.workspaces }));
  }

  async #read(): Promise<WorkspaceRegistryDocument> {
    return decodeWorkspaceRegistry(await this.#store.read());
  }

  async #mutate(
    mutate: (document: WorkspaceRegistryDocument) => WorkspaceRegistryDocument,
  ): Promise<WorkspaceRegistryDocument> {
    return this.#store.update((stored) => {
      const current = decodeWorkspaceRegistry(stored);
      return decodeWorkspaceRegistry(mutate(structuredClone(current)));
    });
  }
}

function resolveRecord(
  document: WorkspaceRegistryDocument,
  selector?: string,
): WorkspaceRecord {
  if (selector === undefined) {
    if (document.defaultTeamId === undefined) {
      throw new WorkspaceRegistryError("DEFAULT_NOT_FOUND", "Default workspace is not configured");
    }
    const byDefault = document.workspaces.find(
      (workspace) => workspace.teamId === document.defaultTeamId,
    );
    if (byDefault) return byDefault;
  } else {
    const exact = document.workspaces.find(
      (workspace) => workspace.teamId === selector || workspace.alias === selector,
    );
    if (exact) return exact;

    let domain: string | undefined;
    if (selector.toLowerCase().endsWith(".slack.com")) {
      try {
        domain = normalizeWorkspaceDomain(selector);
      } catch {
        domain = undefined;
      }
    }
    if (domain !== undefined) {
      const byDomain = document.workspaces.find(
        (workspace) => workspace.domain === domain || workspace.previousDomains.includes(domain),
      );
      if (byDomain) return byDomain;
    }
  }

  throw new WorkspaceRegistryError("WORKSPACE_NOT_FOUND", "Workspace not found");
}
