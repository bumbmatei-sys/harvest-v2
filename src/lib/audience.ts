// Professional V1 audiences, stored on a workspace (PR B); nullable means unspecified.
// "creator" (individual creators) added for Communities (ADR 0013); user-facing wording stays "ministry".
export const audiences = ["church", "ministry_nonprofit", "evangelist_missionary", "creator"] as const;
export type Audience = typeof audiences[number];
