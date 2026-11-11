import { describe, expect, it } from "vitest";
import { embedHosts, videoEmbed } from "../../src/lib/video-embed";

describe("videoEmbed", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ",
  ])("embeds %s through the privacy-enhanced host", (url) => {
    expect(videoEmbed(url)).toEqual({ kind: "embed", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  });
  it.each(["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"])("embeds %s without tracking", (url) => {
    expect(videoEmbed(url)).toEqual({ kind: "embed", src: "https://player.vimeo.com/video/76979871?dnt=1" });
  });
  it("shows other https links as a link card", () => {
    expect(videoEmbed("https://example.test/sermon")).toEqual({ kind: "link", href: "https://example.test/sermon" });
    expect(videoEmbed("https://www.youtube.com/watch?v=bad")).toEqual({ kind: "link", href: "https://www.youtube.com/watch?v=bad" });
  });
  it.each(["http://youtu.be/dQw4w9WgXcQ", "javascript:alert(1)", "not a url", "", "https://" + "a".repeat(600) + ".test"])("refuses %s", (url) => {
    expect(videoEmbed(url)).toBeNull();
  });
  it("only ever embeds from the allow-listed hosts", () => { expect(embedHosts).toEqual(["www.youtube-nocookie.com", "player.vimeo.com"]); });
});
