import { describe, expect, it } from "vitest";
import { parseVideoLink, validVideo, videoEmbedHosts, videoEmbedUrl, videoLink } from "../../src/lib/lesson-video";

const yt = { provider: "youtube", id: "dQw4w9WgXcQ" };
describe("lesson video links", () => {
  it("accepts each allow-listed form and keeps only the provider and video id", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1", "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?si=abc&t=3", "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ/?start=10", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "  https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ  ",
    ]) expect(parseVideoLink(link), link).toEqual(yt);
    for (const link of ["https://vk.com/video-22822305_456241864", "https://vkvideo.ru/video-22822305_456241864", "https://m.vk.com/video-22822305_456241864/",
      "https://vk.com/video_ext.php?oid=-22822305&id=456241864", "https://vkvideo.ru/video_ext.php?oid=-22822305&id=456241864&hd=2"])
      expect(parseVideoLink(link), link).toEqual({ provider: "vk", id: "-22822305_456241864" });
    expect(parseVideoLink("https://vk.com/video_ext.php?oid=123&id=456&hash=8f4b1a2c3d4e5f60")).toEqual({ provider: "vk", id: "123_456_8f4b1a2c3d4e5f60" });
  });
  it("rejects other schemes, hosts, look-alikes, credentials, ports and malformed ids", () => {
    for (const link of [
      "javascript:alert(1)", "JaVaScRiPt:alert('https://youtu.be/dQw4w9WgXcQ')", "data:text/html,<iframe src=https://youtu.be/dQw4w9WgXcQ>", "vbscript:msgbox",
      "ftp://youtu.be/dQw4w9WgXcQ", "file:///etc/passwd", "//youtu.be/dQw4w9WgXcQ", "youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ", "",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "https://evilyoutube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be.evil.example/dQw4w9WgXcQ",
      "https://example.invalid/embed/dQw4w9WgXcQ", "https://vk.com.evil.example/video-1_2", "https://vimeo.com/123456",
      "https://user:pass@youtu.be/dQw4w9WgXcQ", "https://youtu.be:8443/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXc", "https://youtu.be/dQw4w9WgXcQQ",
      "https://youtu.be/dQw4w9WgXcQ/extra", "https://www.youtube.com/watch?v=dQw4w9W<script>", "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/watch", "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ\n<script>",
      "https://vk.com/video-1", "https://vk.com/video_ext.php?oid=-1&id=x", "https://vk.com/video_ext.php?oid=-1&id=2&hash=<b>", "https://vk.com/club1",
      `https://youtu.be/dQw4w9WgXcQ?${"a".repeat(2050)}`,
    ]) expect(parseVideoLink(link), link).toBeNull();
    expect(parseVideoLink(42)).toBeNull();
    expect(parseVideoLink(null)).toBeNull();
  });
  it("builds the canonical link and a privacy-friendly embed on the allowed hosts only", () => {
    expect(videoLink({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(videoLink({ provider: "vk", id: "-1_2" })).toBe("https://vkvideo.ru/video-1_2");
    expect(parseVideoLink(videoLink({ provider: "vk", id: "1_2_abc" }))).toEqual({ provider: "vk", id: "1_2_abc" });
    expect(videoEmbedUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    expect(videoEmbedUrl({ provider: "vk", id: "-1_2_abc" })).toBe("https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=abc&autoplay=1");
    for (const video of [{ provider: "youtube", id: "dQw4w9WgXcQ" }, { provider: "vk", id: "-1_2" }] as const)
      expect(videoEmbedHosts).toContain(new URL(videoEmbedUrl(video)!).hostname);
    // A forged stored value never becomes a frame address.
    for (const video of [{ provider: "youtube", id: "x\" onload=\"alert(1)" }, { provider: "vk", id: "1_2&x=<b>" }, { provider: "other", id: "dQw4w9WgXcQ" }])
      { expect(validVideo(video)).toBe(false); expect(videoEmbedUrl(video as never)).toBeNull(); }
  });
});
