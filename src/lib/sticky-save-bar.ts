/** True when the on-screen keyboard has taken a large part of the layout viewport (visual viewport much shorter than the window). */
export function isKeyboardOpen(layoutHeight: number, visualHeight: number, threshold = 150) {
  return layoutHeight - visualHeight > threshold;
}

/** The status line announced politely: saving wins over unsaved; nothing when the form is clean. */
export function saveBarStatus(dirty: boolean, busy: boolean): "saving" | "unsaved" | null {
  return busy ? "saving" : dirty ? "unsaved" : null;
}

/** Whether a focused control sits under the bar, so it should be scrolled into view. Rectangles are viewport coordinates. */
export function coveredByBar(target: { bottom: number }, bar: { top: number }, margin = 8) {
  return target.bottom > bar.top - margin;
}
