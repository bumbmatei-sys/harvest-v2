import { expect, it, vi } from "vitest";
import { chatPurgeHealth, runChatPurge, runChatPurgeJob } from "../../src/server/community-chat-retention";

const response = (row: Record<string, unknown>) => ({ rows: [row] });
const dm = (fields: Record<string, number> = {}) => response({ result: { deleted: 0, conversations: 0, evidence: 0, expired: 0, reminded: 0, ...fields } });

it("runs before 0058 and stops the channel lane on an empty batch", async () => {
  const query = vi.fn().mockResolvedValueOnce(response({ available: false }))
    .mockResolvedValueOnce(response({ result: { deleted: 3 } })).mockResolvedValueOnce(response({ result: { deleted: 0 } }));
  expect(await runChatPurge({ query })).toEqual({ channels: { counts: { deleted: 3 }, batches: 2, capped: false }, dm: null });
  expect(query).toHaveBeenCalledTimes(3);
});

it("runs both lanes and counts reminders and report expiry as work", async () => {
  const query = vi.fn().mockResolvedValueOnce(response({ available: true }))
    .mockResolvedValueOnce(response({ result: { deleted: 200 } }))
    .mockResolvedValueOnce(response({ result: { deleted: 200 } }))
    .mockResolvedValueOnce(dm({ evidence: 1, expired: 2, reminded: 3 }))
    .mockResolvedValueOnce(dm());
  expect(await runChatPurge({ query }, { maxBatches: 2 })).toEqual({
    channels: { counts: { deleted: 400 }, batches: 2, capped: true },
    dm: { counts: { deleted: 0, conversations: 0, evidence: 1, expired: 2, reminded: 3 }, batches: 2, capped: false },
  });
});

it("records a DM permission failure and does not treat it as a missing migration", async () => {
  const query = vi.fn().mockResolvedValueOnce(response({ available: true }))
    .mockResolvedValueOnce(response({ result: { deleted: 0 } }))
    .mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(response({}));
  expect(await runChatPurgeJob({ query })).toEqual({ ok: false });
  expect(query).toHaveBeenLastCalledWith("select public.community_chat_purge_record_failure($1)", ["sweep_failed"]);
});

it("exposes failed or overdue health, returning only documented fields", async () => {
  const query = vi.fn().mockResolvedValue(response({ health: {
    lastSuccessAt: null, lastStatus: "failed", overdue: true, failedSinceSuccess: true, stray: "do not return",
  } }));
  expect(await chatPurgeHealth({ query })).toEqual({ lastSuccessAt: null, lastStatus: "failed", overdue: true, failedSinceSuccess: true, healthy: false });
});

it("reports a failure if a lane returns an invalid count even when the failure logger is unavailable", async () => {
  const query = vi.fn().mockResolvedValueOnce(response({ available: false }))
    .mockResolvedValueOnce(response({ result: { deleted: -1 } })).mockRejectedValueOnce(new Error());
  expect(await runChatPurgeJob({ query })).toEqual({ ok: false });
  expect(query).toHaveBeenCalledTimes(3);
});
