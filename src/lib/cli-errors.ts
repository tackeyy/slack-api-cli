// CLI のエラー処理ヘルパー。
// src/cli/index.ts から import して使うことで、テストが実コードと結びつく。

export type ExitCode = 0 | 1 | 2;

export type ExitFn = (code: ExitCode) => void;
export type LogFn = (msg: string) => void;

export const handleCliError = (
  err: unknown,
  exit: ExitFn,
  log: LogFn,
): void => {
  const message = err instanceof Error ? err.message : String(err);
  log(`Error: ${message}`);
  exit(1);
};

export interface BuildAuthGuidanceOptions {
  /** workspace registry に登録されている alias の一覧（空配列 = 未登録） */
  workspaceAliases: string[];
  /** SLACK_USER_TOKEN が設定されているか（値は渡さない） */
  hasLegacyUserToken?: boolean;
  /** SLACK_BOT_TOKEN が設定されているか（値は渡さない） */
  hasLegacyBotToken?: boolean;
}

/**
 * 未認証エラー時に表示する self-documenting なガイダンスメッセージを構築する。
 * トークン値は一切含まない（有無のみ表示）。
 */
export function buildAuthGuidanceMessage(options: BuildAuthGuidanceOptions): string {
  const { workspaceAliases, hasLegacyUserToken = false, hasLegacyBotToken = false } = options;
  const lines: string[] = [];

  lines.push("No Slack token is configured.");
  lines.push("");

  if (workspaceAliases.length > 0) {
    // 登録済み workspace がある場合: auth session start を前面に出す
    lines.push("Recommended: start an auth session for a registered workspace:");
    for (const alias of workspaceAliases) {
      lines.push(`  op read 'op://<vault>/<item>/<field>' | slack-api-cli --workspace ${alias} auth session start`);
    }
  } else {
    // 未登録の場合: workspace add → auth session start の順で案内
    lines.push("Recommended authentication flow:");
    lines.push("  1. Register a workspace:");
    lines.push("       slack-api-cli workspace add --team-id <id> --alias <alias> --domain <domain>.slack.com --name \"Name\"");
    lines.push("  2. Start an auth session via stdin from your password manager:");
    lines.push("       op read 'op://<vault>/<item>/<field>' | slack-api-cli --workspace <alias> auth session start");
  }

  lines.push("");
  lines.push("Current state:");

  if (workspaceAliases.length > 0) {
    lines.push(`  workspace registry: registered (${workspaceAliases.join(", ")})`);
  } else {
    lines.push("  workspace registry: not registered (run `slack-api-cli workspace list` to check)");
  }

  const userStatus = hasLegacyUserToken ? "set (deprecated)" : "not set";
  const botStatus = hasLegacyBotToken ? "set (deprecated)" : "not set";
  lines.push(`  SLACK_USER_TOKEN: ${userStatus}`);
  lines.push(`  SLACK_BOT_TOKEN: ${botStatus}`);

  lines.push("");
  lines.push("Note: Authentication via environment variables (SLACK_USER_TOKEN / SLACK_BOT_TOKEN) is deprecated.");
  lines.push("      Use workspace registry and auth session start instead.");

  return lines.join("\n");
}

export interface TokenPair {
  userToken?: string;
  botToken?: string;
}

export const requireToken = (
  env: NodeJS.ProcessEnv,
  exit: ExitFn,
  log: LogFn,
  workspaceAliases: string[] = [],
): TokenPair | undefined => {
  const userToken = env["SLACK_USER_TOKEN"];
  const botToken = env["SLACK_BOT_TOKEN"];
  if (!userToken && !botToken) {
    const guidance = buildAuthGuidanceMessage({
      workspaceAliases,
      hasLegacyUserToken: false,
      hasLegacyBotToken: false,
    });
    log(`Error: ${guidance}`);
    exit(1);
    return undefined;
  }
  return { userToken, botToken };
};
