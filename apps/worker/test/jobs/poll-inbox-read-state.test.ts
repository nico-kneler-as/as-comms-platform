import { describe, expect, it, vi } from "vitest";

import {
  createPollInboxReadStateTask,
  pollInboxReadStateJobName,
} from "../../src/jobs/poll-inbox-read-state.js";
import { createTaskList } from "../../src/tasks.js";
import { createTestWorkerContext } from "../helpers.js";

describe("poll-inbox-read-state task", () => {
  it("registers the task and logs the completed report", async () => {
    const context = await createTestWorkerContext();
    const logger = { log: vi.fn(), error: vi.fn() };
    const report = {
      processed: 2,
      openedByReply: 1,
      openedByRead: 1,
      stayedNew: 0,
      unknown: 0,
    };

    try {
      const taskList = createTaskList(undefined, {
        pollInboxReadState: {
          db: context.db,
          persistence: context.persistence,
          mailbox: "volunteers@adventurescientists.org",
          gmailClient: {
            getMessage: vi.fn(),
          },
          logger,
          readStatePoller: vi.fn().mockResolvedValue(report),
        },
      });
      const task = taskList[pollInboxReadStateJobName];

      expect(task).toBeDefined();
      if (task === undefined) {
        throw new Error("Expected poll inbox read-state task to be registered.");
      }

      await task({}, {} as never);

      expect(logger.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "inbox_read_state.poll.completed",
          ...report,
        }),
      );
    } finally {
      await context.dispose();
    }
  });

  it("logs and rethrows systemic failures", async () => {
    const context = await createTestWorkerContext();
    const logger = { log: vi.fn(), error: vi.fn() };

    try {
      const task = createPollInboxReadStateTask({
        db: context.db,
        persistence: context.persistence,
        mailbox: "volunteers@adventurescientists.org",
        gmailClient: {
          getMessage: vi.fn(),
        },
        logger,
        readStatePoller: vi.fn().mockRejectedValue(new Error("boom")),
      });

      await expect(task({}, {} as never)).rejects.toThrow("boom");
      expect(logger.error).toHaveBeenCalledWith(
        JSON.stringify({
          event: "inbox_read_state.poll.failed",
          message: "boom",
        }),
      );
    } finally {
      await context.dispose();
    }
  });
});
