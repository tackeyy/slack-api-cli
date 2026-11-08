import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "node:fs";
import { handleCliError, requireToken, buildAuthGuidanceMessage } from "../lib/cli-errors.js";
import type { ExitFn, LogFn } from "../lib/cli-errors.js";

// 実 CLI コードと結びついたテスト。
// src/cli/index.ts の createClient() は requireToken を呼んでおり、
// 各コマンドの catch ブロックは将来 handleCliError へ移行可能な形にしてある。

describe("handleCliError", () => {
  let exit: Mock<ExitFn>;
  let log: Mock<LogFn>;

  beforeEach(() => {
    exit = vi.fn<ExitFn>();
    log = vi.fn<LogFn>();
  });

  it("logs an Error's .message and exits with code 1", () => {
    handleCliError(new Error("channel_not_found"), exit, log);
    expect(log).toHaveBeenCalledWith("Error: channel_not_found");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("stringifies non-Error throwables", () => {
    handleCliError("string thrown", exit, log);
    expect(log).toHaveBeenCalledWith("Error: string thrown");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles thrown number values", () => {
    handleCliError(42, exit, log);
    expect(log).toHaveBeenCalledWith("Error: 42");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("calls exit exactly once per error", () => {
    handleCliError(new Error("boom"), exit, log);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("preserves Error subclass message", () => {
    class WebAPIError extends Error {}
    handleCliError(new WebAPIError("not_in_channel"), exit, log);
    expect(log).toHaveBeenCalledWith("Error: not_in_channel");
  });
});

describe("requireToken", () => {
  let exit: Mock<ExitFn>;
  let log: Mock<LogFn>;

  beforeEach(() => {
    exit = vi.fn<ExitFn>();
    log = vi.fn<LogFn>();
  });

  it("returns user token when only SLACK_USER_TOKEN is set", () => {
    const tokens = requireToken({ SLACK_USER_TOKEN: "xoxp-1" }, exit, log);
    expect(tokens?.userToken).toBe("xoxp-1");
    expect(tokens?.botToken).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it("returns bot token when only SLACK_BOT_TOKEN is set", () => {
    const tokens = requireToken({ SLACK_BOT_TOKEN: "xoxb-1" }, exit, log);
    expect(tokens?.botToken).toBe("xoxb-1");
    expect(exit).not.toHaveBeenCalled();
  });

  it("returns both when both env vars are set", () => {
    const tokens = requireToken(
      { SLACK_USER_TOKEN: "xoxp-1", SLACK_BOT_TOKEN: "xoxb-1" },
      exit,
      log,
    );
    expect(tokens?.userToken).toBe("xoxp-1");
    expect(tokens?.botToken).toBe("xoxb-1");
  });

  it("exits with 1 and prints guidance when no token is set", () => {
    const tokens = requireToken({}, exit, log);
    expect(tokens).toBeUndefined();
    const loggedMsg = (log.mock.calls[0]?.[0] as string) ?? "";
    expect(loggedMsg).toContain("SLACK_USER_TOKEN");
    expect(loggedMsg).toContain("auth session start");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not leak env values across calls", () => {
    requireToken({ SLACK_BOT_TOKEN: "xoxb-1" }, exit, log);
    const tokens2 = requireToken({}, exit, log);
    expect(tokens2).toBeUndefined();
  });
});

describe("requireToken — integration with process.env style typing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["SLACK_USER_TOKEN"];
    delete process.env["SLACK_BOT_TOKEN"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("accepts process.env directly", () => {
    process.env["SLACK_BOT_TOKEN"] = "xoxb-real-shape";
    const exit = vi.fn<ExitFn>();
    const log = vi.fn<LogFn>();
    const tokens = requireToken(process.env, exit, log);
    expect(tokens?.botToken).toBe("xoxb-real-shape");
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("buildAuthGuidanceMessage", () => {
  it("contains auth session start command", () => {
    const msg = buildAuthGuidanceMessage({ workspaceAliases: [] });
    expect(msg).toContain("auth session start");
    expect(msg).toContain("workspace add");
  });

  it("does not include token values", () => {
    const msg = buildAuthGuidanceMessage({
      workspaceAliases: [],
      hasLegacyUserToken: true,
      hasLegacyBotToken: false,
    });
    // トークン値（xoxp- / xoxb- プレフィックス等）は含まれない
    expect(msg).not.toMatch(/xox[pb]-/);
  });

  it("registry 未登録時は workspace add の具体手順を案内する", () => {
    const msg = buildAuthGuidanceMessage({ workspaceAliases: [] });
    expect(msg).toContain("workspace add");
    expect(msg).toContain("--team-id");
    expect(msg).toContain("--alias");
  });

  it("registry 登録済み時は alias 一覧を表示して auth session start を案内する", () => {
    const msg = buildAuthGuidanceMessage({ workspaceAliases: ["wedgeai", "manavi"] });
    expect(msg).toContain("wedgeai");
    expect(msg).toContain("manavi");
    expect(msg).toContain("auth session start");
  });

  it("legacy env 有無を有無のみで表示し値は出さない", () => {
    const msg = buildAuthGuidanceMessage({
      workspaceAliases: [],
      hasLegacyUserToken: true,
      hasLegacyBotToken: false,
    });
    expect(msg).toContain("SLACK_USER_TOKEN");
    // 有無の文字を含む（"set" 等）
    expect(msg.toLowerCase()).toMatch(/set/);
  });

  it("legacy env を deprecated と明示する", () => {
    const msg = buildAuthGuidanceMessage({
      workspaceAliases: [],
      hasLegacyUserToken: true,
    });
    expect(msg.toLowerCase()).toMatch(/deprecated/);
  });

  it("registry 登録済み時は workspace add 手順よりも session start を前面に出す", () => {
    const msgWithAliases = buildAuthGuidanceMessage({ workspaceAliases: ["primary"] });
    const sessionStartIdx = msgWithAliases.indexOf("auth session start");
    const workspaceAddIdx = msgWithAliases.indexOf("workspace add");
    // session start の案内が workspace add より先、または workspace add が省略される
    expect(sessionStartIdx).toBeLessThan(workspaceAddIdx === -1 ? Infinity : workspaceAddIdx);
  });
});

describe("command name", () => {
  const root = new URL("../../", import.meta.url);
  const readText = (path: string) => readFileSync(new URL(path, root), "utf8");

  it("installs slack-api-cli and keeps slamy as an alias", () => {
    const pkg = JSON.parse(readText("package.json"));
    const lockRoot = JSON.parse(readText("package-lock.json")).packages[""];
    const expected = { "slack-api-cli": "dist/cli/index.js", slamy: "dist/cli/index.js" };
    expect(pkg.bin).toEqual(expected);
    expect(lockRoot.bin).toEqual(expected);
  });

  it("shows slack-api-cli as the program name", () => {
    expect(readText("src/cli/index.ts")).toContain('.name("slack-api-cli")');
  });

  it("uses slack-api-cli in the authentication guidance", () => {
    const message = buildAuthGuidanceMessage({
      workspaceAliases: [],
      hasLegacyUserToken: false,
      hasLegacyBotToken: false,
    });
    expect(message).toContain("slack-api-cli workspace add");
    expect(message).toContain("slack-api-cli --workspace <alias> auth session start");
    expect(message).toContain("`slack-api-cli workspace list`");
    expect(message).not.toContain("slamy");
  });
});
