import type { Command } from "commander";
import type { ChannelSharingInfo } from "../lib/types.js";
import { createCliTargetClient } from "./target-client.js";
import {
  ensureWorkspaceChannel,
  type EnsureWorkspaceChannelRequest,
  inviteSharedWorkspaceChannel,
  type InviteSharedWorkspaceChannelRequest,
  inviteWorkspaceChannelUsers,
  type InviteWorkspaceChannelUsersRequest,
  kickWorkspaceChannelUser,
  type KickWorkspaceChannelUserRequest,
  renameWorkspaceChannel,
  type RenameWorkspaceChannelRequest,
} from "../lib/channel-management.js";
import {
  formatEnsureChannelResult,
  formatInviteSharedToChannelResult,
  formatInviteToChannelResult,
  formatKickFromChannelResult,
  formatRenameChannelResult,
} from "../output/channel-management.js";
import { resolveCliWorkspaceSelector } from "./api-client.js";
import { parseInvitableUserId, parsePublicChannelId } from "../lib/channel-management.js";

export type ChannelManagementCommandDependencies = {
  ensureChannel: (request: EnsureWorkspaceChannelRequest) => ReturnType<typeof ensureWorkspaceChannel>;
  inviteChannel: (
    request: InviteWorkspaceChannelUsersRequest,
  ) => ReturnType<typeof inviteWorkspaceChannelUsers>;
  kickChannel?: (request: KickWorkspaceChannelUserRequest) => ReturnType<typeof kickWorkspaceChannelUser>;
  inviteSharedChannel?: (
    request: InviteSharedWorkspaceChannelRequest,
    beforeExecute: (target: {
      readonly workspace: string;
      readonly teamId: string;
      readonly channelId: string;
      readonly email: string;
    }) => void,
  ) => ReturnType<typeof inviteSharedWorkspaceChannel>;
  renameChannel?: (request: RenameWorkspaceChannelRequest) => ReturnType<typeof renameWorkspaceChannel>;
  readChannelInfo?: (input: string, workspace?: string, profile?: string) => Promise<ChannelSharingInfo>;
  writeOut: (line: string) => void;
  writeErr: (line: string) => void;
  env?: NodeJS.ProcessEnv;
};

const defaultDependencies: ChannelManagementCommandDependencies = {
  ensureChannel: (request) => ensureWorkspaceChannel(request),
  inviteChannel: (request) => inviteWorkspaceChannelUsers(request),
  kickChannel: (request) => kickWorkspaceChannelUser(request),
  inviteSharedChannel: (request, beforeExecute) => inviteSharedWorkspaceChannel(request, { beforeExecute }),
  renameChannel: (request) => renameWorkspaceChannel(request),
  writeOut: (line) => console.log(line),
  writeErr: (line) => console.error(line),
};

type CreateOptions = {
  topic: string;
  purpose: string;
  private?: boolean;
  dryRun?: boolean;
};

type InviteOptions = {
  dryRun?: boolean;
};

type KickOptions = {
  dryRun?: boolean;
};

type InviteSharedOptions = { email?: string[]; fullAccess?: boolean; dryRun?: boolean };

type RenameOptions = { dryRun?: boolean };

export function registerChannelManagementCommands(
  channels: Command,
  program: Command,
  dependencies: ChannelManagementCommandDependencies = defaultDependencies,
): void {
  channels
    .command("info <channel_or_url>")
    .description("Read privacy and Slack Connect workspace metadata for a channel ID or permalink")
    .action(async (input: string) => {
      try {
        const workspace = resolveCliWorkspaceSelector(
          program.opts<{ workspace?: string }>().workspace, dependencies.env ?? process.env,
        );
        const profile = program.opts<{ profile?: string }>().profile;
        const info = await (dependencies.readChannelInfo ?? readChannelSharingInfo)(input, workspace, profile);
        const mode = outputMode(program);
        if (mode === "json") dependencies.writeOut(sharingJson(info, 2));
        else {
          const keys = ["id", "name", "is_private", "is_shared", "is_ext_shared", "is_pending_ext_shared", "is_im", "is_org_shared", "shared_team_ids", "connected_team_ids", "context_team_id", "conversation_host_id"] as const;
          const values = keys.map((key) => sharingJson(info[key] ?? "unknown"));
          dependencies.writeOut(mode === "plain" ? values.join("\t") : keys.map((key, i) => `${key}: ${values[i]}`).join("\n"));
        }
      } catch {
        dependencies.writeErr("Error: Unable to read channel metadata");
        process.exitCode = 1;
      }
    });

  channels
    .command("create <name>")
    .description("Create or reconcile a channel in an explicit workspace")
    .requiredOption("--topic <text>", "Channel topic")
    .requiredOption("--purpose <text>", "Channel description")
    .option("--private", "Create a private channel")
    .option("--dry-run", "Print the planned operation without reading credentials or Slack")
    .action(async (name: string, options: CreateOptions) => {
      try {
        validateInput(name, options.topic, options.purpose);
        const rootWorkspace = program.opts<{ workspace?: string }>().workspace;
        const workspace = resolveCliWorkspaceSelector(
          rootWorkspace,
          dependencies.env ?? process.env,
        );
        if (workspace === undefined) {
          throw new Error("A workspace selector is required");
        }
        const isPrivate = Boolean(options.private);
        const result = await dependencies.ensureChannel({
          workspace,
          name,
          isPrivate,
          topic: options.topic,
          purpose: options.purpose,
          dryRun: Boolean(options.dryRun),
        });
        dependencies.writeOut(formatEnsureChannelResult(result, outputMode(program)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Channel management failed";
        dependencies.writeErr(`Error: ${message}`);
        process.exitCode = 1;
      }
    });

  channels
    .command("invite-shared <channel>")
    .description("Invite external email recipients through Slack Connect in an explicit workspace")
    .option("--email <addr>", "External recipient email", collectEmail, [])
    .option("--full-access", "Allow external recipients to change channel settings")
    .option("--dry-run", "Print the planned operation without reading credentials or Slack")
    .action(async (channelId: string, options: InviteSharedOptions) => {
      try {
        const emails = options.email ?? [];
        const email = validateSharedInviteInput(channelId, emails);
        const workspace = resolveCliWorkspaceSelector(
          program.opts<{ workspace?: string }>().workspace,
          dependencies.env ?? process.env,
        );
        if (workspace === undefined) throw new Error("A workspace selector is required");
        const beforeExecute = (target: {
          readonly workspace: string;
          readonly teamId: string;
          readonly channelId: string;
          readonly email: string;
        }) => {
          dependencies.writeErr(`workspace alias: ${target.workspace}`);
          dependencies.writeErr(`Team ID: ${target.teamId}`);
          dependencies.writeErr(`channel ID: ${target.channelId}`);
          dependencies.writeErr(`recipient email: ${target.email}`);
        };
        const result = await (dependencies.inviteSharedChannel ?? ((request, announce) =>
          inviteSharedWorkspaceChannel(request, { beforeExecute: announce })))({
          workspace,
          channelId,
          email,
          externalLimited: !options.fullAccess,
          dryRun: Boolean(options.dryRun),
        }, beforeExecute);
        dependencies.writeOut(formatInviteSharedToChannelResult(result, outputMode(program)));
      } catch (error) {
        dependencies.writeErr(`Error: ${channelManagementErrorMessage(error)}`);
        process.exitCode = 1;
      }
    });

  channels
    .command("invite <channel> <user...>")
    .description("Invite one or more users to a channel in an explicit workspace")
    .option("--dry-run", "Print the planned operation without reading credentials or Slack")
    .action(async (channelId: string, userIds: string[], options: InviteOptions) => {
      try {
        validateInviteInput(channelId, userIds);
        const rootWorkspace = program.opts<{ workspace?: string }>().workspace;
        const workspace = resolveCliWorkspaceSelector(
          rootWorkspace,
          dependencies.env ?? process.env,
        );
        if (workspace === undefined) throw new Error("A workspace selector is required");
        const result = await dependencies.inviteChannel({
          workspace,
          channelId,
          userIds,
          dryRun: Boolean(options.dryRun),
        });
        dependencies.writeOut(formatInviteToChannelResult(result, outputMode(program)));
      } catch (error) {
        dependencies.writeErr(`Error: ${channelManagementErrorMessage(error)}`);
        process.exitCode = 1;
      }
    });

  channels
    .command("kick <channel> <user>")
    .description("Remove a user from a channel in an explicit workspace")
    .option("--dry-run", "Print the planned operation without reading credentials or Slack")
    .action(async (channelId: string, userId: string, options: KickOptions) => {
      try {
        validateKickInput(channelId, userId);
        const rootWorkspace = program.opts<{ workspace?: string }>().workspace;
        const workspace = resolveCliWorkspaceSelector(
          rootWorkspace,
          dependencies.env ?? process.env,
        );
        if (workspace === undefined) throw new Error("A workspace selector is required");
        const result = await (dependencies.kickChannel ?? kickWorkspaceChannelUser)({
          workspace,
          channelId,
          userId,
          dryRun: Boolean(options.dryRun),
        });
        dependencies.writeOut(formatKickFromChannelResult(result, outputMode(program)));
      } catch (error) {
        dependencies.writeErr(`Error: ${channelManagementErrorMessage(error)}`);
        process.exitCode = 1;
      }
    });

  channels
    .command("rename <channel> <name>")
    .description("Rename a channel in an explicit workspace")
    .option("--dry-run", "Print the planned operation without reading credentials or Slack")
    .action(async (channelId: string, name: string, options: RenameOptions) => {
      try {
        validateRenameInput(channelId, name);
        const workspace = resolveCliWorkspaceSelector(
          program.opts<{ workspace?: string }>().workspace,
          dependencies.env ?? process.env,
        );
        if (workspace === undefined) throw new Error("A workspace selector is required");
        const result = await (dependencies.renameChannel ?? renameWorkspaceChannel)({
          workspace, channelId, name, dryRun: Boolean(options.dryRun),
        });
        dependencies.writeOut(formatRenameChannelResult(result, outputMode(program)));
      } catch (error) {
        dependencies.writeErr(`Error: ${channelManagementErrorMessage(error)}`);
        process.exitCode = 1;
      }
    });
}

function validateInput(name: string, topic: string, purpose: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) {
    throw new Error("Channel name must use lowercase letters, numbers, hyphens, or underscores");
  }
  for (const [label, value] of [["topic", topic], ["purpose", purpose]] as const) {
    if (value.length < 1 || value.length > 250 || /[\u0000\u007f]/.test(value)) {
      throw new Error(`Channel ${label} must contain 1 to 250 safe characters`);
    }
  }
}

function validateInviteInput(channelId: string, userIds: readonly string[]): void {
  if (!/^C[A-Z0-9]+$/.test(channelId)) {
    throw new Error("Channel ID must start with C and contain only uppercase letters or numbers");
  }
  if (userIds.length < 1) throw new Error("At least one user ID is required");
  if (userIds.some((userId) => !/^[UW][A-Z0-9]+$/.test(userId))) {
    throw new Error("User IDs must start with U or W and contain only uppercase letters or numbers");
  }
}

function validateKickInput(channelId: string, userId: string): void {
  try {
    parsePublicChannelId(channelId);
  } catch {
    throw new Error(
      "Channel ID must start with C and contain 1 to 63 uppercase letters or numbers",
    );
  }
  try {
    parseInvitableUserId(userId);
  } catch {
    throw new Error(
      "User ID must start with U or W and contain 1 to 127 uppercase letters or numbers",
    );
  }
}

function collectEmail(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function validateSharedInviteInput(channelId: string, emails: readonly string[]): string {
  if (!/^[CG][A-Z0-9]+$/.test(channelId)) {
    throw new Error("Channel ID must start with C or G and contain only uppercase letters or numbers");
  }
  if (emails.length !== 1) throw new Error("Exactly one email is required");
  const [email] = emails;
  if (!/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email)) {
    throw new Error("Email must be in local@domain.tld format without spaces or commas");
  }
  return email;
}

function validateRenameInput(channelId: string, name: string): void {
  if (!/^[CG][A-Z0-9]+$/.test(channelId)) {
    throw new Error("Channel ID must start with C or G and contain only uppercase letters or numbers");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) {
    throw new Error("Channel name must use lowercase letters, numbers, hyphens, or underscores");
  }
}

function channelManagementErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "platformCode" in error) {
    const code = error.platformCode;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return error instanceof Error ? error.message : "Channel management failed";
}

function outputMode(program: Command): "human" | "json" | "plain" {
  const options = program.opts<{ json?: boolean; plain?: boolean }>();
  if (options.json) return "json";
  if (options.plain) return "plain";
  return "human";
}

async function readChannelSharingInfo(input: string, explicitWorkspace?: string, profile?: string): Promise<ChannelSharingInfo> {
  const lease = await createCliTargetClient<{ getChannelSharingInfo(id: string): Promise<ChannelSharingInfo> }>({ input, explicitWorkspace, profile });
  try { return await lease.client.getChannelSharingInfo(lease.target.channel); }
  finally { lease.dispose(); }
}

function sharingJson(value: unknown, spaces?: number): string {
  return JSON.stringify(value, null, spaces).replace(/[\u007f-\u009f\u2028\u2029]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
