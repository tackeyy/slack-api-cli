import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { registerChannelManagementCommands } from "../cli/channels.js";
const targetClient = vi.hoisted(() => vi.fn());
vi.mock("../cli/target-client.js", () => ({ createCliTargetClient: targetClient }));
it("routes a DM ID and profile from the root CLI to the target client", async () => {
  const argv = process.argv;
  const write = vi.spyOn(console, "log").mockImplementation(() => {});
  const getChannelSharingInfo = vi.fn().mockResolvedValue({ id: "D0TEST", is_im: true });
  const dispose = vi.fn();
  targetClient.mockResolvedValue({ client: { getChannelSharingInfo }, target: { channel: "D0TEST" }, dispose });
  try {
    vi.resetModules();
    process.argv = ["node", "slamy", "channels", "info", "D0TEST", "--profile", "x", "--workspace", "example", "--json"];
    await import("../cli/index.js");
    expect(targetClient).toHaveBeenCalledWith({ input: "D0TEST", explicitWorkspace: "example", profile: "x" });
    expect(getChannelSharingInfo).toHaveBeenCalledWith("D0TEST");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0]![0])).toEqual({ id: "D0TEST", is_im: true });
  } finally { process.argv = argv; write.mockRestore(); vi.resetModules(); }
});
afterEach(() => { process.exitCode = undefined; targetClient.mockReset(); });
function setup(mode: "json" | "plain" | "human", value: unknown) {
  const program = new Command().option("--json").option("--plain").option("--workspace <selector>");
  const readChannelInfo = vi.fn().mockResolvedValue(value);
  const writeOut = vi.fn(); const writeErr = vi.fn();
  registerChannelManagementCommands(program.command("channels"), program, { ensureChannel: vi.fn(), inviteChannel: vi.fn(), readChannelInfo, writeOut, writeErr });
  return { program, readChannelInfo, writeOut, writeErr, args: ["node", "slamy", ...(mode === "human" ? [] : [`--${mode}`]), "--workspace", "example", "channels", "info", "https://example.slack.com/archives/C012ABC/p1700000000000001"] };
}
it("prints pending sharing and DM flags in human output", async () => {
  const t = setup("human", { id: "D0TEST", is_pending_ext_shared: false, is_im: true });
  await t.program.parseAsync(t.args);
  expect(t.writeOut.mock.calls[0]![0]).toContain("is_pending_ext_shared: false\nis_im: true");
});
it.each([undefined, false, true])("prints both new flags in each output format: %s", async (value) => {
  const info = value === undefined ? { id: "D0TEST" } : { id: "D0TEST", is_pending_ext_shared: value, is_im: value };
  for (const mode of ["json", "human", "plain"] as const) {
    const t = setup(mode, info);
    await t.program.parseAsync(t.args);
    const output = t.writeOut.mock.calls[0]![0];
    if (mode === "json") expect(JSON.parse(output)).toEqual(info);
    else if (mode === "human") {
      for (const field of ["is_pending_ext_shared", "is_im"]) expect(output).toContain(`${field}: ${JSON.stringify(value ?? "unknown")}`);
    } else expect(output.split("\t").slice(5, 7)).toEqual(Array(2).fill(JSON.stringify(value ?? "unknown")));
  }
});
it("routes the permalink and explicit workspace through the shared resolver", async () => {
  const t = setup("json", { id: "C012ABC", is_private: true, shared_team_ids: ["T012ABC"] });
  await t.program.parseAsync(t.args);
  expect(t.readChannelInfo).toHaveBeenCalledWith("https://example.slack.com/archives/C012ABC/p1700000000000001", "example", undefined);
  expect(JSON.parse(t.writeOut.mock.calls[0]![0])).toEqual({ id: "C012ABC", is_private: true, shared_team_ids: ["T012ABC"] });
});
it.each(["human", "plain"] as const)("shows missing flags and teams as unknown in %s", async (mode) => {
  const t = setup(mode, { id: "C012ABC" }); await t.program.parseAsync(t.args);
  expect(t.writeOut.mock.calls[0]![0]).toContain("unknown");
  expect(t.writeOut.mock.calls[0]![0]).not.toContain("false");
});
it("does not silently succeed when the API fails", async () => {
  const t = setup("json", {}); t.readChannelInfo.mockRejectedValue(new Error("channel_not_found"));
  await t.program.parseAsync(t.args);
  expect(process.exitCode).toBe(1); expect(t.writeOut).not.toHaveBeenCalled();
});

it.each([false, true])("default path resolves workspace and disposes the lease even on failure=%s", async (fails) => {
  const dispose = vi.fn();
  const getChannelSharingInfo = fails ? vi.fn().mockRejectedValue(new Error("fixture")) : vi.fn().mockResolvedValue({ id: "C012ABC" });
  targetClient.mockResolvedValue({ client: { getChannelSharingInfo }, target: { channel: "C012ABC" }, dispose });
  const program = new Command().option("--json").option("--workspace <selector>");
  const writeOut = vi.fn();
  registerChannelManagementCommands(program.command("channels"), program, { ensureChannel: vi.fn(), inviteChannel: vi.fn(), writeOut, writeErr: vi.fn() });
  await program.parseAsync(["node", "slamy", "--json", "--workspace", "example", "channels", "info", "https://example.slack.com/archives/C012ABC/p1700000000000001"]);
  expect(targetClient).toHaveBeenCalledWith({ input: "https://example.slack.com/archives/C012ABC/p1700000000000001", explicitWorkspace: "example" });
  expect(getChannelSharingInfo).toHaveBeenCalledWith("C012ABC");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(writeOut).toHaveBeenCalledTimes(fails ? 0 : 1);
});

it.each(["json", "plain", "human"] as const)("escapes all control and Unicode line characters in %s", async (mode) => {
  const t = setup(mode, { id: "C012ABC", name: "a\u007f\u0080\u0085\u009b\u009d\u009f\u2028\u2029b" });
  await t.program.parseAsync(t.args);
  expect(t.writeOut.mock.calls[0]![0]).not.toMatch(/[\u007f-\u009f\u2028\u2029]/u);
});
it("routes a real permalink with an in-memory registry and no credentials", async () => {
  const { createCliTargetClient } = await vi.importActual<typeof import("../cli/target-client.js")>("../cli/target-client.js");
  const { WorkspaceRegistry } = await import("../workspace/registry.js");
  const { parseTeamId } = await import("../domain/team-id.js");
  const registry = new WorkspaceRegistry({ read: async () => ({ version: 1, workspaces: [{ teamId: parseTeamId("T012ABC"), alias: "example", domain: "example.slack.com", previousDomains: [], displayName: "Example" }] }), write: async () => { throw Error(); }, update: async () => { throw Error(); } });
  const dispose = vi.fn(); const getChannelSharingInfo = vi.fn().mockResolvedValue({ id: "C012ABC" });
  targetClient.mockImplementation((options) => createCliTargetClient({ ...options, registry, env: {}, clientLeaseFactory: async () => ({ client: { getChannelSharingInfo }, dispose }) }));
  const program = new Command().option("--json").option("--workspace <selector>");
  registerChannelManagementCommands(program.command("channels"), program, { ensureChannel: vi.fn(), inviteChannel: vi.fn(), writeOut: vi.fn(), writeErr: vi.fn() });
  await program.parseAsync(["node", "slamy", "--json", "--workspace", "example", "channels", "info", "https://example.slack.com/archives/C012ABC/p1700000000000001"]);
  expect(getChannelSharingInfo).toHaveBeenCalledWith("C012ABC"); expect(dispose).toHaveBeenCalledTimes(1);
});
