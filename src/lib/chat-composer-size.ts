/** One line of the message field is 44px (the tap-target minimum); it grows by a line height up to four lines, then scrolls. */
export const composerLineHeight = 20;
export const composerMinHeight = 44;
export const composerMaxLines = 4;
/** Vertical padding of the field (10px above and below one line). */
export const composerPadding = 20;
export const composerMaxHeight = composerMaxLines * composerLineHeight + composerPadding;

/** The height to give the field for its content: at least one line, at most four, scrolling beyond that. */
export function composerHeight(scrollHeight: number) {
  if (!Number.isFinite(scrollHeight)) return composerMinHeight;
  return Math.round(Math.min(composerMaxHeight, Math.max(composerMinHeight, scrollHeight)));
}
