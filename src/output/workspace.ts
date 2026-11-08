import type { WorkspaceCredentialRefs, WorkspaceView } from "../domain/workspace.js";
import { looksLikeSlackSecret } from "../domain/slack-secret.js";

export type WorkspaceOutputMode = "human" | "json" | "plain";

export function formatWorkspaceList(
  workspaces: WorkspaceView[],
  mode: WorkspaceOutputMode,
): string {
  const safe = workspaces.map(redactUnsafeCredentialRefs);
  if (mode === "json") return JSON.stringify(safe, null, 2);
  if (mode === "plain") return safe.map(formatTsv).join("\n");
  if (safe.length === 0) return "No workspaces configured";
  return safe
    .map(
      (workspace) =>
        `${workspace.isDefault ? "*" : " "} ${workspace.alias} (${workspace.teamId}) ${workspace.domain} — ${workspace.displayName}${workspace.profiles?.length ? ` — profiles: ${workspace.profiles.map((item) => item.name).join(", ")}` : ""}`,
    )
    .join("\n");
}

export function formatWorkspace(workspace: WorkspaceView, mode: WorkspaceOutputMode): string {
  const safe = redactUnsafeCredentialRefs(workspace);
  if (mode === "json") return JSON.stringify(safe, null, 2);
  if (mode === "plain") return formatTsv(safe);

  const previous = safe.previousDomains.length === 0 ? "none" : safe.previousDomains.join(", ");
  const credentials = formatCredentialRefs(safe.credentialRefs);
  return [
    `Workspace: ${safe.displayName} (${safe.teamId})`,
    `Alias: ${safe.alias}`,
    `Domain: ${safe.domain}`,
    `Previous domains: ${previous}`,
    `Default: ${safe.isDefault ? "yes" : "no"}`,
    `Credential references: ${credentials}`,
    ...(safe.profiles?.length ? [`Profiles: ${safe.profiles.map((item) => item.name).join(", ")}`] : []),
  ].join("\n");
}

export function formatDefaultWorkspaceCleared(mode: WorkspaceOutputMode): string {
  if (mode === "json") return JSON.stringify({ ok: true, defaultTeamId: null }, null, 2);
  if (mode === "plain") return "ok\t";
  return "Default workspace cleared";
}

function formatTsv(workspace: WorkspaceView): string {
  return [
    workspace.teamId,
    workspace.alias,
    workspace.domain,
    workspace.displayName,
    String(workspace.isDefault),
    workspace.previousDomains.join(","),
    workspace.credentialRefs?.user?.name ?? "",
    workspace.credentialRefs?.bot?.name ?? "",
    ...(workspace.profiles?.length ? [workspace.profiles.map((item) => item.name).join(",")] : []),
  ]
    .map(sanitizeTsv)
    .join("\t");
}

function sanitizeTsv(value: string): string {
  return value.replace(/[\t\r\n]/g, " ");
}

function formatCredentialRefs(refs: WorkspaceCredentialRefs | undefined): string {
  if (!refs) return "none";
  const values = [refs.user && `user=${refs.user.name}`, refs.bot && `bot=${refs.bot.name}`].filter(
    Boolean,
  );
  return values.length === 0 ? "none" : values.join(", ");
}

function redactUnsafeCredentialRefs(workspace: WorkspaceView): WorkspaceView {
  const credentialRefs = workspace.credentialRefs;
  if (workspace.profiles?.length) {
    workspace = { ...workspace, profiles: workspace.profiles.map((item) => ({
      ...item, credentialRefs: redactUnsafeCredentialRefs({ ...workspace, profiles: undefined,
        credentialRefs: item.credentialRefs }).credentialRefs!,
    })) };
  }
  if (!credentialRefs) return workspace;
  return {
    ...workspace,
    credentialRefs: {
      ...(credentialRefs.user
        ? { user: { ...credentialRefs.user, name: safeReferenceName(credentialRefs.user.name) } }
        : {}),
      ...(credentialRefs.bot
        ? { bot: { ...credentialRefs.bot, name: safeReferenceName(credentialRefs.bot.name) } }
        : {}),
    },
  };
}

function safeReferenceName(name: string): string {
  return looksLikeSlackSecret(name) ? "[REDACTED]" : name;
}
