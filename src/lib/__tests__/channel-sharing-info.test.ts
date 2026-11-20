import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlamyClient } from "../client.js";
const info = vi.hoisted(() => vi.fn());
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () { return { conversations: { info } }; }),
  LogLevel: { ERROR: "error" },
}));
beforeEach(() => { info.mockReset(); });
const client = () => new SlamyClient({ userToken: "fixture" });
describe("channel sharing metadata", () => {
  it("preserves pending sharing and DM flags including false", async () => {
    const channel = { id: "D0TEST", is_pending_ext_shared: false, is_im: true };
    info.mockResolvedValue({ ok: true, channel });
    expect(await client().getChannelSharingInfo("D0TEST")).toEqual(channel);
  });
  it("accepts a DM ID without returning conversation content", async () => {
    info.mockResolvedValue({ ok: true, channel: { id: "D0TEST", topic: {}, purpose: {}, latest: {}, messages: [] } });
    expect(await client().getChannelSharingInfo("D0TEST")).toEqual({ id: "D0TEST" });
    expect(info).toHaveBeenCalledWith({ channel: "D0TEST" });
  });
  it("returns only sharing metadata and preserves Enterprise host IDs", async () => {
    const channel = { id: "C012ABC", name: "example", is_private: true, is_shared: true, is_ext_shared: true, is_org_shared: false, shared_team_ids: ["T012ABC", "T034DEF"], connected_team_ids: ["T034DEF"], context_team_id: "T012ABC", conversation_host_id: "E056GHI" };
    info.mockResolvedValue({ ok: true, channel: { ...channel, topic: { value: "private discussion" }, latest: { text: "private message" } } });
    expect(await client().getChannelSharingInfo("C012ABC")).toEqual(channel);
    expect(info).toHaveBeenCalledWith({ channel: "C012ABC" });
  });
  it("keeps missing fields unknown rather than declaring unshared/public", async () => {
    info.mockResolvedValue({ ok: true, channel: { id: "C012ABC" } });
    expect(await client().getChannelSharingInfo("C012ABC")).toEqual({ id: "C012ABC" });
  });
  it.each([false, undefined, null])("rejects missing or wrong channel identity: %s", async (channel) => {
    info.mockResolvedValue({ ok: true, channel });
    await expect(client().getChannelSharingInfo("C012ABC")).rejects.toThrow("Invalid channel metadata");
  });
  it("rejects a different channel ID", async () => {
    info.mockResolvedValue({ ok: true, channel: { id: "C999XYZ" } });
    await expect(client().getChannelSharingInfo("C012ABC")).rejects.toThrow("Invalid channel metadata");
  });
  it.each(["is_private", "is_shared", "is_ext_shared", "is_org_shared", "is_pending_ext_shared", "is_im"])("does not coerce %s", async (field) => {
    info.mockResolvedValue({ ok: true, channel: { id: "C012ABC", [field]: "false" } });
    await expect(client().getChannelSharingInfo("C012ABC")).rejects.toThrow("Invalid channel metadata");
  });
  it.each(["shared_team_ids", "connected_team_ids"])("rejects malformed %s", async (field) => {
    info.mockResolvedValue({ ok: true, channel: { id: "C012ABC", [field]: ["T012ABC", "not-a-team"] } });
    await expect(client().getChannelSharingInfo("C012ABC")).rejects.toThrow("Invalid channel metadata");
  });
  it("propagates API failures without another API call", async () => {
    info.mockRejectedValue(new Error("channel_not_found"));
    await expect(client().getChannelSharingInfo("C012ABC")).rejects.toThrow("channel_not_found");
    expect(info).toHaveBeenCalledTimes(1);
  });
});

it.each(["d0TEST", "D0test", "U0TEST", "D", "D" + "A".repeat(64)])("rejects invalid ID %s before the API call", async (id) => {
  await expect(client().getChannelSharingInfo(id)).rejects.toThrow("Invalid channel ID");
  expect(info).not.toHaveBeenCalled();
});
it("accepts a 64-character DM ID", async () => {
  const id = "D" + "A".repeat(63);
  info.mockResolvedValue({ ok: true, channel: { id } });
  expect(await client().getChannelSharingInfo(id)).toEqual({ id });
});
it.each(["is_pending_ext_shared", "is_im"])("omits undefined %s and rejects non-booleans", async (field) => {
  for (const value of [undefined, true, false, null, 0, {}, []]) {
    info.mockResolvedValue({ ok: true, channel: { id: "D0TEST", [field]: value } });
    if (value === undefined) expect(await client().getChannelSharingInfo("D0TEST")).toEqual({ id: "D0TEST" });
    else if (typeof value === "boolean") expect(await client().getChannelSharingInfo("D0TEST")).toEqual({ id: "D0TEST", [field]: value });
    else await expect(client().getChannelSharingInfo("D0TEST")).rejects.toThrow("Invalid channel metadata");
  }
});

it.each([
  { name: "a".repeat(1025) }, { shared_team_ids: ["T" + "A".repeat(64)] },
  { connected_team_ids: ["T" + "A".repeat(64)] }, { context_team_id: "T" + "A".repeat(64) },
  { conversation_host_id: "E" + "A".repeat(64) },
])("rejects oversized metadata %j", async (extra) => {
  info.mockResolvedValue({ ok: true, channel: { id: "C012ABC", ...extra } });
  await expect(client().getChannelSharingInfo("C012ABC")).rejects.toThrow("Invalid channel metadata");
});
it("accepts the name and identifier length boundaries", async () => {
  const channel = { id: "C012ABC", name: "a".repeat(1024), shared_team_ids: ["T" + "A".repeat(63)], conversation_host_id: "E" + "A".repeat(63) };
  info.mockResolvedValue({ ok: true, channel });
  expect(await client().getChannelSharingInfo("C012ABC")).toEqual(channel);
});
