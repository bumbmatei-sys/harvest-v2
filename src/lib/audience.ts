// The three Professional V1 audiences. Stored on a workspace in PR B; nullable means unspecified.
export const audiences = ["church", "ministry_nonprofit", "evangelist_missionary"] as const;
export type Audience = typeof audiences[number];
