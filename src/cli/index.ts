#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { createWriteStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SlamyClient } from "../lib/client.js";
import { formatTimestamp as libFormatTimestamp } from "../lib/tz.js";
import { jsonOutput as formatJson } from "../lib/cli-format.js";
import {
  collectCliWorkspaceSelector,
  collectCliProfileSelector,
  createCliApiClient,
} from "./api-client.js";
import { createCliTargetClient } from "./target-client.js";
import { registerWorkspaceCommands } from "./workspace.js";
import { registerChannelManagementCommands } from "./channels.js";
import { registerLocalSessionCommands } from "./session.js";
import { runLocalSessionDaemonFromStdin } from "../lib/local-session-daemon.js";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf-8"),
) as { version: string };

const program = new Command();

program
  .name("slack-api-cli")
  .description("Slack CLI tool")
  .version(pkg.version)
  .option(
    "--workspace <selector>",
    "Use workspace by alias, Team ID, or fully-qualified Slack domain",
    (selector: string, previous: string | undefined) => {
      try {
        return collectCliWorkspaceSelector(selector, previous);
      } catch (error) {
        throw new InvalidArgumentError(
          error instanceof Error ? error.message : "Invalid workspace selector",
        );
      }
    },
  )
  .option("--profile <name>", "Use a named credential profile", collectCliProfileSelector)
  .option("--json", "Output in JSON format")
  .option("--plain", "Output in TSV format")
  .option("--utc", "Display timestamps in UTC (default: local TZ)")
  .option("--tz <tz>", "Display timestamps in the specified IANA TZ (e.g. Asia/Tokyo)");

function getOutputMode(): "json" | "plain" | "human" {
  const opts = program.opts();
  if (opts.json) return "json";
  if (opts.plain) return "plain";
  return "human";
}

function getTzOptions(): { utc?: boolean; tz?: string } {
  const opts = program.opts();
  return { utc: opts.utc, tz: opts.tz };
}

async function createClient(): Promise<SlamyClient> {
  const lease = await createCliApiClient({
    explicitWorkspace: program.opts<{ workspace?: string }>().workspace,
    profile: program.opts<{ profile?: string }>().profile,
  });
  lease.dispose();
  return lease.client;
}

async function createTargetClient(
  input: string,
  messageTs?: string,
  threadTs?: string,
): Promise<{
  client: SlamyClient;
  target: { channel: string; ts?: string; thread_ts?: string };
}> {
  const lease = await createCliTargetClient<SlamyClient>({
    input,
    ...(messageTs ? { messageTs } : {}),
    ...(threadTs ? { threadTs } : {}),
    explicitWorkspace: program.opts<{ workspace?: string }>().workspace,
    profile: program.opts<{ profile?: string }>().profile,
  });
  lease.dispose();
  return { client: lease.client, target: lease.target };
}

function jsonOutput(data: unknown): void {
  console.log(formatJson(data));
}

function formatTimestamp(ts: string): string {
  return libFormatTimestamp(ts, getTzOptions());
}

registerWorkspaceCommands(program);

// "Name (U123)" 形式のラベラーを返す。id が解決できなければ id のみ。
async function buildUserLabeler(
  client: SlamyClient,
  ids: string[],
): Promise<(id: string) => string> {
  const uniq = Array.from(new Set(ids.filter((id) => id)));
  const names = await client.resolveUserNames(uniq);
  return (id: string): string => {
    if (!id) return id;
    const name = names.get(id);
    if (!name || name === id) return id;
    return `${name} (${id})`;
  };
}

// --- auth ---
const auth = program.command("auth").description("Authentication commands");

registerLocalSessionCommands(auth, program);

program
  .command("__session-daemon", { hidden: true })
  .action(async () => {
    try {
      await runLocalSessionDaemonFromStdin();
    } catch {
      process.exitCode = 1;
    }
  });

auth
  .command("test")
  .description("Test authentication with Slack API")
  .action(async () => {
    try {
      const client = await createClient();
      const info = await client.authTest();
      const mode = getOutputMode();

      if (mode === "json") {
        jsonOutput(info);
      } else if (mode === "plain") {
        console.log(`${info.user_id}\t${info.user}\t${info.team_id}\t${info.team}`);
      } else {
        console.log(`Authenticated as: ${info.user} (${info.user_id})`);
        console.log(`Team: ${info.team} (${info.team_id})`);
        console.log(`URL: ${info.url}`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- team ---
const team = program.command("team").description("Workspace (team) operations");

team
  .command("info")
  .description(
    "Get workspace info (domain, email_domain, enterprise). Note: SSO enforcement settings are not exposed by the Slack API.",
  )
  .action(async () => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const info = await client.getTeamInfo();

      if (mode === "json") {
        jsonOutput(info);
      } else if (mode === "plain") {
        console.log(
          `${info.id}\t${info.name}\t${info.domain}\t${info.email_domain}\t${info.enterprise_id}\t${info.enterprise_name}`,
        );
      } else {
        console.log(`Team: ${info.name} (${info.id})`);
        console.log(`Domain: ${info.domain}.slack.com`);
        if (info.email_domain) console.log(`Email domain: ${info.email_domain}`);
        if (info.enterprise_name)
          console.log(`Enterprise: ${info.enterprise_name} (${info.enterprise_id})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- channels ---
const channels = program.command("channels").description("Channel operations");

registerChannelManagementCommands(channels, program);
// These separately owned command paths do not yet accept a profile. Fail closed.
for (const command of channels.commands) {
  command.hook("preAction", () => {
    if (program.opts<{ profile?: string }>().profile !== undefined) {
      throw new Error("--profile is not supported by this channel management command");
    }
  });
}

channels
  .command("list")
  .description("List channels")
  .option("--limit <n>", "Maximum number of channels", "100")
  .option("--include-archived", "Include archived channels")
  .option("--unread", "Only show channels with unread messages")
  .action(async (opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const limit = parseInt(opts.limit, 10);

      if (opts.unread) {
        const unreadChannels = await client.listUnreadChannels({ limit });

        if (mode === "json") {
          jsonOutput(unreadChannels);
        } else if (mode === "plain") {
          for (const ch of unreadChannels) {
            console.log(
              `${ch.id}\t${ch.name}\t${ch.num_members}\t${ch.is_private ? "private" : ""}\t${ch.unread_count}`,
            );
          }
        } else {
          if (unreadChannels.length === 0) {
            console.log("No unread channels");
          } else {
            for (const ch of unreadChannels) {
              const priv = ch.is_private ? " (private)" : "";
              console.log(
                `#${ch.name.padEnd(30)} ${ch.id}${priv}  [${ch.unread_count} unread]`,
              );
            }
          }
        }
      } else {
        const allChannels = await client.listChannels({
          limit,
          includeArchived: opts.includeArchived,
        });

        if (mode === "json") {
          jsonOutput(allChannels);
        } else if (mode === "plain") {
          for (const ch of allChannels) {
            console.log(
              `${ch.id}\t${ch.name}\t${ch.num_members}\t${ch.is_private ? "private" : ""}\t${ch.topic}`,
            );
          }
        } else {
          for (const ch of allChannels) {
            const priv = ch.is_private ? " (private)" : "";
            console.log(
              `#${ch.name.padEnd(30)} ${ch.id}${priv}  [${ch.num_members} members]`,
            );
          }
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

channels
  .command("history <channel_or_url>")
  .description("Get channel message history (channel ID or Slack permalink URL)")
  .option("--limit <n>", "Maximum number of messages", "20")
  .option("--oldest <ts>", "Only messages after this Unix timestamp")
  .option("--latest <ts>", "Only messages before this Unix timestamp")
  .option("--resolve-names", "Resolve user_id / bot_id to display names")
  .action(async (channelOrUrl, opts) => {
    try {
      const { client, target } = await createTargetClient(channelOrUrl);
      const mode = getOutputMode();
      const messages = await client.getChannelHistory(target.channel, {
        limit: parseInt(opts.limit, 10),
        oldest: opts.oldest,
        latest: opts.latest,
      });

      const labelFor = opts.resolveNames
        ? await buildUserLabeler(client, messages.map((m) => m.user).filter((u) => !!u))
        : (id: string) => id;

      if (mode === "json") {
        jsonOutput(messages);
      } else if (mode === "plain") {
        for (const msg of messages) {
          const text = msg.text.replace(/\n/g, "\\n");
          console.log(`${msg.ts}\t${labelFor(msg.user)}\t${text}`);
        }
      } else {
        for (const msg of messages) {
          const ts = formatTimestamp(msg.ts);
          const thread = msg.reply_count ? ` [${msg.reply_count} replies]` : "";
          console.log(`[${ts}] ${labelFor(msg.user)}: ${msg.text}${thread}`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

channels
  .command("members <channel_or_url>")
  .description("List channel members (channel ID or Slack permalink URL)")
  .option("--resolve-names", "Resolve user_id to display names")
  .action(async (channelOrUrl, opts) => {
    try {
      const { client, target } = await createTargetClient(channelOrUrl);
      const mode = getOutputMode();
      const members = await client.getChannelMembers(target.channel);

      const labelFor = opts.resolveNames
        ? await buildUserLabeler(client, members)
        : (id: string) => id;

      if (mode === "json") {
        jsonOutput(members);
      } else if (mode === "plain") {
        for (const m of members) {
          console.log(labelFor(m));
        }
      } else {
        console.log(`${members.length} members:`);
        for (const m of members) {
          console.log(`  ${labelFor(m)}`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- messages ---
const messages = program.command("messages").description("Message operations");

messages
  .command("post <channel_id>")
  .description("Post a message to a channel")
  .requiredOption("--text <text>", "Message text")
  .option("--as-user", "Post as the authenticated user (uses user token instead of bot token)")
  .option("--thread-ts <ts>", "Reply in the thread of this message ts (e.g. 1700000000.000100)")
  .option("--blocks-file <path>", "JSON file with a Block Kit blocks array (text becomes the fallback; no auto-split)")
  .action(async (channelId, opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      let blocks: unknown[] | undefined;
      if (opts.blocksFile !== undefined) {
        const { readBlocksFile } = await import("../lib/blocks-file.js");
        const { readFileSync } = await import("node:fs");
        const path: string = opts.blocksFile;
        blocks = readBlocksFile(() => readFileSync(path, "utf8")) as unknown[];
      }
      const result = await client.postMessage(channelId, opts.text, {
        asUser: opts.asUser === true,
        threadTs: opts.threadTs,
        ...(blocks !== undefined ? { blocks } : {}),
      });

      if (mode === "json") {
        jsonOutput(result);
      } else if (mode === "plain") {
        console.log(`${result.channel}\t${result.ts}`);
      } else {
        console.log(`Message posted to ${result.channel} (ts: ${result.ts})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

messages
  .command("schedule <channel_id>")
  .description("Schedule a message for later")
  .requiredOption("--text <text>", "Message text")
  .requiredOption("--at <datetime>", "Post time (Unix timestamp or ISO 8601 e.g. 2026-02-24T09:00+09:00)")
  .action(async (channelId, opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();

      let postAt: number;
      const parsed = Number(opts.at);
      if (!isNaN(parsed) && parsed > 1000000000) {
        postAt = parsed;
      } else {
        const d = new Date(opts.at);
        if (isNaN(d.getTime())) {
          console.error("Error: Invalid datetime format. Use Unix timestamp or ISO 8601.");
          process.exit(1);
        }
        postAt = Math.floor(d.getTime() / 1000);
      }

      const result = await client.scheduleMessage(channelId, opts.text, postAt);
      const tzOpts = getTzOptions();
      const scheduled = libFormatTimestamp(String(postAt), tzOpts);
      const tzLabel = tzOpts.utc ? " UTC" : tzOpts.tz ? ` ${tzOpts.tz}` : "";

      if (mode === "json") {
        jsonOutput(result);
      } else if (mode === "plain") {
        console.log(`${result.channel}\t${result.scheduled_message_id}\t${postAt}`);
      } else {
        console.log(`Message scheduled for ${scheduled}${tzLabel} (id: ${result.scheduled_message_id})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

messages
  .command("reply <channel_or_url> [thread_ts]")
  .description("Reply to a thread (channel + thread_ts, or Slack permalink URL)")
  .requiredOption("--text <text>", "Reply text")
  .option("--broadcast", "Also post to the channel (reply_broadcast)")
  .action(async (channelOrUrl, threadTsArg, opts) => {
    try {
      const { client, target } = await createTargetClient(
        channelOrUrl,
        undefined,
        threadTsArg,
      );
      const mode = getOutputMode();
      if (!target.thread_ts) {
        console.error("Error: thread_ts is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      const result = await client.replyToThread(target.channel, target.thread_ts, opts.text, {
        broadcast: opts.broadcast,
      });

      if (mode === "json") {
        jsonOutput({ channel: result.channel, ts: result.ts, thread_ts: target.thread_ts });
      } else if (mode === "plain") {
        console.log(`${result.channel}\t${result.ts}\t${target.thread_ts}`);
      } else {
        console.log(
          `Reply posted to ${result.channel} thread ${target.thread_ts} (ts: ${result.ts})`,
        );
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

messages
  .command("update <channel_or_url> [ts]")
  .description("Update a message (channel + ts, or Slack permalink URL)")
  .requiredOption("--text <text>", "New message text")
  .action(async (channelOrUrl, tsArg, opts) => {
    try {
      const { client, target } = await createTargetClient(channelOrUrl, tsArg);
      const mode = getOutputMode();
      if (!target.ts) {
        console.error("Error: ts is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      const result = await client.updateMessage(target.channel, target.ts, opts.text);

      if (mode === "json") {
        jsonOutput(result);
      } else if (mode === "plain") {
        console.log(`${result.channel}\t${result.ts}`);
      } else {
        console.log(`Message updated in ${result.channel} (ts: ${result.ts})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

messages
  .command("delete <channel_or_url> [ts]")
  .description("Delete a message (channel + ts, or Slack permalink URL)")
  .action(async (channelOrUrl, tsArg) => {
    try {
      const { client, target } = await createTargetClient(channelOrUrl, tsArg);
      const mode = getOutputMode();
      if (!target.ts) {
        console.error("Error: ts is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      await client.deleteMessage(target.channel, target.ts);

      if (mode === "json") {
        jsonOutput({ channel: target.channel, ts: target.ts, deleted: true });
      } else if (mode === "plain") {
        console.log(`${target.channel}\t${target.ts}\tdeleted`);
      } else {
        console.log(`Message deleted from ${target.channel} (ts: ${target.ts})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- users ---
const users = program.command("users").description("User operations");

users
  .command("list")
  .description("List workspace users")
  .option("--include-deactivated", "Include deactivated users")
  .option("--include-bots", "Include bot users")
  .action(async (opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const userList = await client.listUsers({
        includeDeactivated: opts.includeDeactivated,
        includeBots: opts.includeBots,
      });

      if (mode === "json") {
        jsonOutput(userList);
      } else if (mode === "plain") {
        for (const u of userList) {
          console.log(
            `${u.id}\t${u.name}\t${u.real_name}\t${u.display_name}\t${u.email || ""}`,
          );
        }
      } else {
        for (const u of userList) {
          const display = u.display_name || u.real_name;
          console.log(`${u.id.padEnd(12)} @${u.name.padEnd(20)} ${display}`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

users
  .command("profile <user_id>")
  .description("Get user profile")
  .action(async (userId) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const profile = await client.getUserProfile(userId);

      if (mode === "json") {
        jsonOutput(profile);
      } else if (mode === "plain") {
        console.log(
          `${profile.id}\t${profile.name}\t${profile.real_name}\t${profile.display_name}\t${profile.email}\t${profile.title}`,
        );
      } else {
        const display = profile.display_name || profile.real_name;
        console.log(`User: ${display} (@${profile.name})`);
        console.log(`ID: ${profile.id}`);
        if (profile.team_id) console.log(`Team: ${profile.team_id}`);
        if (profile.is_ultra_restricted) console.log("Guest: single-channel");
        else if (profile.is_restricted) console.log("Guest: multi-channel");
        if (profile.title) console.log(`Title: ${profile.title}`);
        if (profile.email) console.log(`Email: ${profile.email}`);
        if (profile.status_text)
          console.log(`Status: ${profile.status_emoji} ${profile.status_text}`);
        console.log(`Timezone: ${profile.tz}`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

users
  .command("set-real-name <user_id> <real_name>")
  .description("Set a user's real name (admin user token; can target bot users)")
  .action(async (userId, realName) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const res = await client.setUserRealName(userId, realName);

      if (mode === "json") {
        jsonOutput(res);
      } else if (mode === "plain") {
        console.log(`${res.id}\t${res.real_name}`);
      } else {
        console.log(`Updated real name: ${res.real_name} (${res.id})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

users
  .command("set-display-name <user_id> <display_name>")
  .description("Set a user's display name (admin user token; can target bot users)")
  .action(async (userId, displayName) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const res = await client.setUserDisplayName(userId, displayName);

      if (mode === "json") {
        jsonOutput(res);
      } else if (mode === "plain") {
        console.log(`${res.id}\t${res.display_name}`);
      } else {
        console.log(`Updated display name: ${res.display_name} (${res.id})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- reactions ---
const reactions = program.command("reactions").description("Reaction operations");

reactions
  .command("list")
  .description("List reactions made by a user (requires User Token)")
  .option("--user <user_id>", "User ID (default: authenticated user)")
  .option("--limit <n>", "Maximum number of reactions to fetch", "100")
  .option("--count", "Output total count only")
  .option("--resolve-names", "Resolve channel_id to channel names")
  .action(async (opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const limit = parseInt(opts.limit, 10);
      const result = await client.listReactions({
        user: opts.user,
        limit,
      });

      if (opts.count) {
        console.log(result.total);
        return;
      }

      // JSON モードでは生の channel_id をそのまま返すので解決スキップ (API コール節約)
      const channelLabelFor =
        opts.resolveNames && mode !== "json"
          ? await (async () => {
              const ids = Array.from(new Set(result.items.map((i) => i.channel).filter((c) => !!c)));
              const names = await client.resolveChannelNames(ids);
              return (id: string): string => {
                const name = names.get(id);
                return name && name !== id ? name : id;
              };
            })()
          : (id: string) => id;

      if (mode === "json") {
        jsonOutput(result);
      } else if (mode === "plain") {
        for (const item of result.items) {
          const text = item.message_text.replace(/\n/g, "\\n");
          console.log(
            `${item.name}\t${channelLabelFor(item.channel)}\t${item.timestamp}\t${text}`,
          );
        }
      } else {
        if (result.items.length === 0) {
          console.log("No reactions found");
          return;
        }
        console.log(`${result.total} reaction(s):\n`);
        for (const item of result.items) {
          const ts = formatTimestamp(item.timestamp);
          let text = item.message_text;
          if (text.length > 60) text = text.slice(0, 60) + "...";
          console.log(
            `:${item.name.padEnd(20)} #${channelLabelFor(item.channel).padEnd(20)} [${ts}] ${text}`,
          );
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

reactions
  .command("get <channel_or_url> [timestamp]")
  .description("Get reactions on a specific message (channel + ts, or Slack permalink URL)")
  .option("--resolve-names", "Resolve user_id to display names")
  .action(async (channelOrUrl, timestampArg, opts) => {
    try {
      const { client, target } = await createTargetClient(
        channelOrUrl,
        timestampArg,
      );
      const mode = getOutputMode();
      if (!target.ts) {
        console.error("Error: timestamp is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      const detail = await client.getMessageReactionsDetail(target.channel, target.ts);
      const reactions = detail.reactions;

      const labelFor = opts.resolveNames
        ? await buildUserLabeler(client, reactions.flatMap((r) => r.users))
        : (id: string) => id;

      if (mode === "json") {
        jsonOutput({
          channel: target.channel,
          ts: target.ts,
          message_text: detail.message_text,
          reactions,
        });
      } else if (mode === "plain") {
        for (const r of reactions) {
          console.log(`${r.name}\t${r.count}\t${r.users.map(labelFor).join(",")}`);
        }
      } else {
        if (detail.message_text) {
          const preview =
            detail.message_text.length > 100
              ? detail.message_text.slice(0, 100) + "..."
              : detail.message_text;
          console.log(`Message: ${preview}\n`);
        }
        if (reactions.length === 0) {
          console.log("No reactions on this message");
          return;
        }
        for (const r of reactions) {
          const users = r.users.map(labelFor).join(", ");
          console.log(`:${r.name}: ${r.count}  ${users}`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

reactions
  .command("add <channel_or_url> [timestamp]")
  .description("Add a reaction to a message (channel + ts, or Slack permalink URL)")
  .requiredOption("--name <emoji>", "Reaction emoji name (without colons)")
  .action(async (channelOrUrl, timestampArg, opts) => {
    try {
      const { client, target } = await createTargetClient(
        channelOrUrl,
        timestampArg,
      );
      const mode = getOutputMode();
      if (!target.ts) {
        console.error("Error: timestamp is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      await client.addReaction(target.channel, target.ts, opts.name);

      if (mode === "json") {
        jsonOutput({ channel: target.channel, ts: target.ts, reaction: opts.name });
      } else if (mode === "plain") {
        console.log(`${target.channel}\t${target.ts}\t${opts.name}`);
      } else {
        console.log(
          `Reaction :${opts.name}: added to ${target.channel} at ${target.ts}`,
        );
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

reactions
  .command("remove <channel_or_url> [timestamp]")
  .description("Remove a reaction from a message (channel + ts, or Slack permalink URL)")
  .requiredOption("--name <emoji>", "Reaction emoji name (without colons)")
  .action(async (channelOrUrl, timestampArg, opts) => {
    try {
      const { client, target } = await createTargetClient(
        channelOrUrl,
        timestampArg,
      );
      const mode = getOutputMode();
      if (!target.ts) {
        console.error("Error: timestamp is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      await client.removeReaction(target.channel, target.ts, opts.name);

      if (mode === "json") {
        jsonOutput({ channel: target.channel, ts: target.ts, reaction: opts.name, removed: true });
      } else if (mode === "plain") {
        console.log(`${target.channel}\t${target.ts}\t${opts.name}\tremoved`);
      } else {
        console.log(
          `Reaction :${opts.name}: removed from ${target.channel} at ${target.ts}`,
        );
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- search ---
const search = program.command("search").description("Search operations");

search
  .command("messages <query>")
  .description("Search messages (requires User Token)")
  .option("--count <n>", "Number of results per page", "20")
  .option("--page <n>", "Page number", "1")
  .option("--sort <field>", "Sort by (timestamp or score)", "timestamp")
  .option("--sort-dir <dir>", "Sort direction (asc or desc)", "desc")
  .option("--resolve-names", "Resolve user_id / bot_id to display names")
  .action(async (query, opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const result = await client.searchMessages(query, {
        count: parseInt(opts.count, 10),
        page: parseInt(opts.page, 10),
        sort: opts.sort,
        sortDir: opts.sortDir,
      });

      const labelFor = opts.resolveNames
        ? await buildUserLabeler(client, result.matches.map((m) => m.user).filter((u) => !!u))
        : (id: string) => id;

      if (mode === "json") {
        jsonOutput(result);
      } else if (mode === "plain") {
        for (const m of result.matches) {
          const text = m.text.replace(/\n/g, "\\n");
          console.log(
            `${m.ts}\t${m.channel_id}\t${m.channel}\t${labelFor(m.user)}\t${text}\t${m.permalink}`,
          );
        }
      } else {
        console.log(`Found ${result.total} results (page ${result.page})\n`);
        for (const m of result.matches) {
          const ts = formatTimestamp(m.ts);
          let text = m.text;
          if (text.length > 200) text = text.slice(0, 200) + "...";
          console.log(`[${ts}] #${m.channel} ${labelFor(m.user)}:`);
          console.log(`  ${text}`);
          console.log(`  ${m.permalink}\n`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- threads ---
const threads = program.command("threads").description("Thread operations");

threads
  .command("replies <channel_or_url> [thread_ts]")
  .description("Get thread replies (channel + thread_ts, or Slack permalink URL)")
  .option("--limit <n>", "Maximum number of replies", "50")
  .option("--resolve-names", "Resolve user_id / bot_id to display names")
  .action(async (channelOrUrl, threadTsArg, opts) => {
    try {
      const { client, target } = await createTargetClient(
        channelOrUrl,
        undefined,
        threadTsArg,
      );
      const mode = getOutputMode();
      if (!target.thread_ts) {
        console.error("Error: thread_ts is required (pass as 2nd arg or via permalink URL)");
        process.exit(1);
      }
      const msgs = await client.getThreadReplies(target.channel, target.thread_ts, {
        limit: parseInt(opts.limit, 10),
      });

      const labelFor = opts.resolveNames
        ? await buildUserLabeler(client, msgs.map((m) => m.user).filter((u) => !!u))
        : (id: string) => id;

      if (mode === "json") {
        jsonOutput(msgs);
      } else if (mode === "plain") {
        for (const msg of msgs) {
          const text = msg.text.replace(/\n/g, "\\n");
          console.log(`${msg.ts}\t${labelFor(msg.user)}\t${text}`);
        }
      } else {
        for (const msg of msgs) {
          const ts = formatTimestamp(msg.ts);
          console.log(`[${ts}] ${labelFor(msg.user)}: ${msg.text}`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- files ---
const files = program.command("files").description("File operations");

files
  .command("upload <channel_id> <file_paths...>")
  .description("Upload one or more files in a single post (channel ID or user ID)")
  .option("--thread-ts <ts>", "Thread timestamp")
  .option("--title <title>", "File title")
  .option("--filename <name>", "File name")
  .option("--initial-comment <text>", "Initial comment with the file")
  .option("--as-user", "Upload as the authenticated user (uses user token instead of bot token)")
  .action(async (channelId, filePaths, opts) => {
    try {
      if (filePaths.length > 1 && (opts.title !== undefined || opts.filename !== undefined)) {
        throw new Error("--title and --filename can be used only with a single file");
      }
      const client = await createClient();
      const mode = getOutputMode();
      if (filePaths.length === 1) {
        await client.uploadFile(channelId, filePaths[0], {
          asUser: opts.asUser === true,
          threadTs: opts.threadTs,
          title: opts.title,
          filename: opts.filename,
          initialComment: opts.initialComment,
        });

        if (mode === "json") {
          jsonOutput({ channel: channelId, file: filePaths[0], uploaded: true });
        } else if (mode === "plain") {
          console.log(`${channelId}\t${filePaths[0]}\tuploaded`);
        } else {
          console.log(`File uploaded to ${channelId}: ${filePaths[0]}`);
        }
      } else {
        await client.uploadFiles(channelId, filePaths, {
          asUser: opts.asUser === true,
          threadTs: opts.threadTs,
          initialComment: opts.initialComment,
        });

        if (mode === "json") {
          jsonOutput({ channel: channelId, files: filePaths, uploaded: true });
        } else if (mode === "plain") {
          for (const filePath of filePaths) {
            console.log(`${channelId}\t${filePath}\tuploaded`);
          }
        } else {
          console.log(`Files uploaded to ${channelId}: ${filePaths.join(", ")}`);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

files
  .command("download <file_id_or_url>")
  .description("Download a file from Slack")
  .option("--output <path>", "Save path (default: original filename in current directory)")
  .action(async (fileIdOrUrl, opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();

      let downloadUrl: string;
      let filename: string;

      if (fileIdOrUrl.startsWith("http")) {
        downloadUrl = fileIdOrUrl;
        filename = basename(new URL(fileIdOrUrl).pathname);
      } else {
        const info = await client.getFileInfo(fileIdOrUrl);
        downloadUrl = info.url_private_download;
        filename = info.name;
      }

      const outputPath = opts.output || filename;
      const response = await client.downloadFileStream(downloadUrl);
      const body = response.body;
      if (!body) throw new Error("Empty response body");

      const readable = Readable.fromWeb(body as any);
      await pipeline(readable, createWriteStream(outputPath));

      if (mode === "json") {
        jsonOutput({ file: fileIdOrUrl, output: outputPath, downloaded: true });
      } else if (mode === "plain") {
        console.log(`${fileIdOrUrl}\t${outputPath}\tdownloaded`);
      } else {
        console.log(`Downloaded: ${outputPath}`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- engagement ---
const engagement = program.command("engagement").description("Engagement metrics");

engagement
  .command("user <user_id>")
  .description("Get engagement metrics for a single user")
  .requiredOption("--since <date>", "Start date (YYYY-MM-DD)")
  .option("--until <date>", "End date (YYYY-MM-DD, default: same as since)")
  .action(async (userId, opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const result = await client.getUserEngagement(userId, {
        since: opts.since,
        until: opts.until,
      });

      if (mode === "json") {
        jsonOutput(result);
      } else if (mode === "plain") {
        console.log(
          `${result.userId}\t${result.since}\t${result.until}\t${result.postCount}\t${result.reactionGivenCount}`,
        );
      } else {
        console.log(`User: ${result.userId}`);
        console.log(`Period: ${result.since} ~ ${result.until}`);
        console.log(`Posts: ${result.postCount}`);
        console.log(`Reactions given: ${result.reactionGivenCount}`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

engagement
  .command("team")
  .description("Get engagement metrics for all team members")
  .requiredOption("--since <date>", "Start date (YYYY-MM-DD)")
  .option("--until <date>", "End date (YYYY-MM-DD, default: same as since)")
  .option("--delay <ms>", "Delay between API calls in ms (rate limit)", "3000")
  .action(async (opts) => {
    try {
      const client = await createClient();
      const mode = getOutputMode();
      const delay = parseInt(opts.delay, 10);
      const users = await client.listUsers();

      const results = [];
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        if (mode === "human") {
          process.stderr.write(
            `\r[${i + 1}/${users.length}] ${user.display_name || user.real_name}...`,
          );
        }
        const metrics = await client.getUserEngagement(user.id, {
          since: opts.since,
          until: opts.until,
        });
        results.push({
          ...metrics,
          displayName: user.display_name || user.real_name,
        });
        if (i < users.length - 1 && delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (mode === "human") {
        process.stderr.write("\r" + " ".repeat(60) + "\r");
      }

      if (mode === "json") {
        jsonOutput(results);
      } else if (mode === "plain") {
        for (const r of results) {
          console.log(
            `${r.userId}\t${r.displayName}\t${r.since}\t${r.until}\t${r.postCount}\t${r.reactionGivenCount}`,
          );
        }
      } else {
        // テーブル形式
        console.log(`\nEngagement: ${results[0]?.since || opts.since} ~ ${results[0]?.until || opts.until || opts.since}\n`);
        const sorted = [...results].sort((a, b) => b.postCount - a.postCount);
        const nameWidth = Math.max(...sorted.map((r) => r.displayName.length), 4);
        console.log(
          `${"Name".padEnd(nameWidth)}  Posts  Reactions`,
        );
        console.log("-".repeat(nameWidth + 18));
        for (const r of sorted) {
          console.log(
            `${r.displayName.padEnd(nameWidth)}  ${String(r.postCount).padStart(5)}  ${String(r.reactionGivenCount).padStart(9)}`,
          );
        }
        console.log(`\nTotal: ${results.length} members`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- assistant ---
const assistant = program.command("assistant").description("AI Assistant App operations");

assistant
  .command("set-status")
  .description("Set status text on an AI Assistant thread (typing indicator)")
  .requiredOption("--channel <id>", "Channel ID (e.g. D123 or C123)")
  .requiredOption("--thread <ts>", "Thread timestamp (e.g. 1700000000.000100)")
  .requiredOption("--status <text>", "Status text (empty string to clear)")
  .option("--loading-message <text...>", "Rotating loading messages")
  .action(async (opts: { channel: string; thread: string; status: string; loadingMessage?: string[] }) => {
    try {
      const client = await createClient();
      const apiOpts = opts.loadingMessage && opts.loadingMessage.length > 0
        ? { loadingMessages: opts.loadingMessage }
        : undefined;
      await client.setAssistantStatus(opts.channel, opts.thread, opts.status, apiOpts);
      const mode = getOutputMode();
      if (mode === "json") {
        jsonOutput({ ok: true, channel: opts.channel, thread: opts.thread, status: opts.status });
      } else if (mode === "plain") {
        console.log(`ok\t${opts.channel}\t${opts.thread}\t${opts.status}`);
      } else {
        console.log(`✅ status set on ${opts.channel}/${opts.thread}: "${opts.status}"`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

await program.parseAsync();
