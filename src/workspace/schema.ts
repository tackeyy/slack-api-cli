import { parseTeamId } from "../domain/team-id.js";
import { looksLikeSlackSecret } from "../domain/slack-secret.js";
import { WorkspaceRegistryError, type WorkspaceRegistryErrorCode } from "./errors.js";
import type {
  CredentialReference,
  WorkspaceCredentialRefs,
  WorkspaceRecord,
  WorkspaceRegistryDocument,
} from "./types.js";

const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.slack\.com$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export function emptyWorkspaceRegistry(): WorkspaceRegistryDocument {
  return { version: 1, workspaces: [] };
}

export function parseWorkspaceRegistryJson(text: string): WorkspaceRegistryDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid("Registry file is not valid JSON");
  }
  return decodeWorkspaceRegistry(value);
}

export function serializeWorkspaceRegistry(document: WorkspaceRegistryDocument): string {
  return `${JSON.stringify(decodeWorkspaceRegistry(document), null, 2)}\n`;
}

export function decodeWorkspaceRegistry(value: unknown): WorkspaceRegistryDocument {
  const input = asObject(value, "registry document");
  assertExactKeys(input, ["version", "defaultTeamId", "workspaces"], "registry document");
  if (input.version !== 1) {
    throw new WorkspaceRegistryError("UNSUPPORTED_VERSION", "Unsupported workspace registry version");
  }
  if (!Array.isArray(input.workspaces)) {
    throw invalid("Registry workspaces must be an array");
  }

  const workspaces = input.workspaces.map((item) => decodeWorkspace(item));
  const defaultTeamId = input.defaultTeamId === undefined ? undefined : safeTeamId(input.defaultTeamId);
  validateUniqueness(workspaces);
  if (defaultTeamId !== undefined && !workspaces.some((item) => item.teamId === defaultTeamId)) {
    throw new WorkspaceRegistryError(
      "DEFAULT_NOT_FOUND",
      "Default Team ID does not exist in the workspace registry",
    );
  }

  return {
    version: 1,
    ...(defaultTeamId === undefined ? {} : { defaultTeamId }),
    workspaces,
  };
}

export function validateWorkspaceAlias(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 63 ||
    !ALIAS_PATTERN.test(value)
  ) {
    throw invalid("Workspace alias is invalid");
  }
  return value;
}

export function normalizeWorkspaceDomain(value: unknown): string {
  if (typeof value !== "string") throw invalid("Workspace domain is invalid");
  const normalized = value.toLowerCase().endsWith(".slack.com")
    ? value.toLowerCase()
    : `${value.toLowerCase()}.slack.com`;
  if (!DOMAIN_PATTERN.test(normalized)) throw invalid("Workspace domain is invalid");
  return normalized;
}

function decodeWorkspace(value: unknown): WorkspaceRecord {
  const input = asObject(value, "workspace record");
  assertExactKeys(
    input,
    ["teamId", "alias", "domain", "previousDomains", "displayName", "credentialRefs", "profiles"],
    "workspace record",
  );
  if (!Array.isArray(input.previousDomains)) {
    throw invalid("Workspace previousDomains must be an array");
  }
  if (
    typeof input.displayName !== "string" ||
    input.displayName.length < 1 ||
    input.displayName.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(input.displayName)
  ) {
    throw invalid("Workspace displayName is invalid");
  }

  const domain = normalizeWorkspaceDomain(input.domain);
  const previousDomains = input.previousDomains.map(normalizeWorkspaceDomain);
  if (new Set(previousDomains).size !== previousDomains.length || previousDomains.includes(domain)) {
    throw new WorkspaceRegistryError("DUPLICATE_DOMAIN", "Workspace domains must be unique");
  }

  const profiles = decodeProfiles(input.profiles);
  return {
    ...(profiles.length ? { profiles } : {}),
    teamId: safeTeamId(input.teamId),
    alias: validateWorkspaceAlias(input.alias),
    domain,
    previousDomains,
    displayName: input.displayName,
    ...(input.credentialRefs === undefined
      ? {}
      : { credentialRefs: decodeCredentialRefs(input.credentialRefs) }),
  };
}

function decodeCredentialRefs(value: unknown): WorkspaceCredentialRefs {
  const input = asObject(value, "credentialRefs");
  assertExactKeys(input, ["user", "bot"], "credentialRefs");
  if (input.user === undefined && input.bot === undefined) {
    throw invalid("credentialRefs must contain user or bot");
  }
  return {
    ...(input.user === undefined ? {} : { user: decodeCredentialRef(input.user) }),
    ...(input.bot === undefined ? {} : { bot: decodeCredentialRef(input.bot) }),
  };
}

function decodeCredentialRef(value: unknown): CredentialReference {
  const input = asObject(value, "credential reference");
  assertExactKeys(input, ["provider", "name"], "credential reference");
  if (typeof input.provider !== "string" || !PROVIDER_ID_PATTERN.test(input.provider)) {
    throw invalid("Credential provider ID is invalid");
  }
  if (
    typeof input.name !== "string" ||
    input.name.length < 1 ||
    input.name.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.name) ||
    looksLikeSlackSecret(input.name) ||
    (input.provider === "environment" && !ENV_NAME_PATTERN.test(input.name))
  ) {
    throw invalid("Credential reference is invalid");
  }
  return { provider: input.provider, name: input.name };
}

function validateUniqueness(workspaces: WorkspaceRecord[]): void {
  assertUnique(workspaces.map((item) => item.teamId), "DUPLICATE_TEAM_ID", "Team IDs");
  assertUnique(workspaces.map((item) => item.alias), "DUPLICATE_ALIAS", "Workspace aliases");
  assertUnique(
    workspaces.flatMap((item) => [item.domain, ...item.previousDomains]),
    "DUPLICATE_DOMAIN",
    "Workspace domains",
  );
}

function assertUnique(
  values: string[],
  code: WorkspaceRegistryErrorCode,
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new WorkspaceRegistryError(code, `${label} must be unique`);
  }
}

function safeTeamId(value: unknown): WorkspaceRecord["teamId"] {
  try {
    return parseTeamId(value);
  } catch {
    throw invalid("Workspace Team ID is invalid");
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw invalid(`${label} contains unknown fields`);
  }
}

function invalid(message: string): WorkspaceRegistryError {
  return new WorkspaceRegistryError("INVALID_CONFIG", message);
}

export function validateWorkspaceProfile(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 32 ||
      !ALIAS_PATTERN.test(value) || value === "default" || looksLikeSlackSecret(value)) {
    throw invalid("Workspace profile name is invalid");
  }
  return value;
}

function decodeProfiles(value: unknown): NonNullable<WorkspaceRecord["profiles"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid("Workspace profiles must be an array");
  const profiles = value.map((item) => {
    const input = asObject(item, "workspace profile");
    assertExactKeys(input, ["name", "credentialRefs"], "workspace profile");
    const credentialRefs = decodeCredentialRefs(input.credentialRefs);
    if (Object.values(credentialRefs).some((ref) => ref.provider !== "environment")) {
      throw invalid("Workspace profiles require environment references");
    }
    return { name: validateWorkspaceProfile(input.name), credentialRefs };
  });
  if (new Set(profiles.map((profile) => profile.name)).size !== profiles.length) {
    throw invalid("Workspace profile names must be unique");
  }
  return profiles;
}
