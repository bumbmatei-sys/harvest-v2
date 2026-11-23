/** Email clients cannot read CSS variables, so the email renderer's literal colours live here (the only place the source guard allows them). */
export const emailColors = {
  defaultPrimary: "#1f4d3a", defaultAccent: "#c8963e", defaultCanvas: "#f4f1ea",
  ink: "#23272e", muted: "#5d6470", white: "#ffffff", black: "#1a1a1a",
  darkCanvas: "#121417", darkCard: "#1b1e23", darkPanel: "#232830", darkBorder: "#3a414c", darkQuote: "#2a2f37", darkInk: "#eceef1",
} as const;
