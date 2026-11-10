import type { Job as BullJob } from "bullmq";
import type { StoryJobData } from "@/lib/queue";
import { advanceStory, failPlanning, planStory } from "@/server/services/story";

// Hàng đợi story: lập kịch bản (gateway, chat chính Muse) và đẩy cảnh kế tiếp / ghép khi cảnh xong.
export async function processStory(bullJob: BullJob<StoryJobData>): Promise<void> {
  const { storyId, action } = bullJob.data;
  try {
    if (action === "plan") await planStory(storyId);
    else await advanceStory(storyId);
  } catch (err) {
    const attempts = bullJob.opts.attempts ?? 1;
    if (action === "plan" && bullJob.attemptsMade + 1 >= attempts) await failPlanning(storyId, "PLAN_FAILED");
    throw err;
  }
}
