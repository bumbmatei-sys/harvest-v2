import type { AutoDmPlatform, AutoDmTrigger } from "../../lib/social/auto-dm";

export type AutoDmEvent = {
  accountRef: string; platform: AutoDmPlatform; kind: "message.received" | "comment.received";
  subjectRef: string; activityRef: string; signal: AbortSignal;
};
export type AutoDmEvidence = {
  trigger: AutoDmTrigger; recipientRef: string; at: Date; lastInboundAt: Date;
  text: string | null; firstName: string | null; firstInbound: boolean; entryKey: string | null;
  postRef: string | null; conversationRef: string | null; targetRef: string;
};
