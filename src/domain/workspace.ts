import type { TeamId } from "./team-id.js";

export type CredentialReference = {
  provider: string;
  name: string;
};

export type EnvironmentCredentialRef = CredentialReference & {
  provider: "environment";
};

export type WorkspaceCredentialRefs = {
  user?: CredentialReference;
  bot?: CredentialReference;
};

export type WorkspaceRecord = {
  teamId: TeamId;
  alias: string;
  domain: string;
  previousDomains: string[];
  displayName: string;
  credentialRefs?: WorkspaceCredentialRefs;
  profiles?: { name: string; credentialRefs: WorkspaceCredentialRefs }[];
};

export type WorkspaceView = WorkspaceRecord & { isDefault: boolean; profile?: string };
