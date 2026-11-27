import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { CatalogTypeArt, catalogTypeArtVars } from "../../src/components/catalog/catalog-type-art";
import { CatalogPreview } from "../../src/components/catalog/catalog-preview";
import {
  addressFollowsTitle, blankForm, catalogKinds, draftPayload, emptyBody, fileSize, formFromItem, move, newLesson, nextAddress, problems, publicPath, publishChecklist, stepOfCheck,
  type CatalogFile, type CatalogForm,
} from "../../src/lib/catalog";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));
const file = (status: CatalogFile["status"], id = "f1", visibility: CatalogFile["visibility"] = "private"): CatalogFile => ({ id, name: `${id}.pdf`, mime: "application/pdf", size: 10, status, visibility });
const form = (change: Partial<CatalogForm> = {}): CatalogForm => ({ ...blankForm(), title: "Basics", slug: "basics", visibility: "unlisted", ...change });

describe("catalogue type art", () => {
  it("draws decorative, self-contained art for every supported type, different for each", () => {
    const motifs = new Set<string>();
    for (const kind of catalogKinds) {
      const html = render(h(CatalogTypeArt, { kind }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-catalog-type-art="${kind}"`);
      expect(html).not.toMatch(/<image|href=|url\(|\bid="/);
      motifs.add(html.slice(html.lastIndexOf("<svg")));
    }
    expect(motifs.size).toBe(catalogKinds.length);
  });
  it("reads its colours only from the palette's art slots, one slot per type", () => {
    const first = catalogKinds.map((kind) => {
      const values = Object.values(catalogTypeArtVars(kind)) as string[];
      for (const value of values) expect(value).toMatch(/^var\(--art-[1-5]-(from|to|glow|ink)\)$/);
      return values[0];
    });
    expect(new Set(first).size).toBe(catalogKinds.length);
  });
  it("shows the art as the preview cover with a free badge and no price", () => {
    const html = render(h(CatalogPreview, { kind: "course", title: "Basics", summary: "Start here", slug: "basics", host: "Grace Church" }));
    expect(html).toContain('data-catalog-type-art="course"');
    expect(html).toContain("Free");
    expect(html).toContain("/courses/basics");
    expect(html).not.toMatch(/\$|price|checkout/i);
  });
});

describe("catalogue rules", () => {
  it("builds the draft the server expects, per kind", () => {
    const lesson = { ...newLesson(), title: "  One  ", published: true, section: "s1", videoUrl: " https://youtu.be/dQw4w9WgXcQ " };
    const second = { ...newLesson(), id: "11111111-1111-4111-8111-111111111111", title: "Two", body: emptyBody(), section: "s1" };
    const sections = [{ key: "s1", title: " Week one ", level: null }];
    expect(draftPayload("course", form({ sections, lessons: [lesson, second], labels: { level: "", section: " Week ", lesson: "" } }))).toEqual({
      kind: "course", title: "Basics", slug: "basics", summary: "", visibility: "unlisted", labels: { level: null, section: "Week", lesson: null },
      sections: [{ title: "Week one", lessons: [{ title: "One", published: true, body: lesson.body, videoUrl: "https://youtu.be/dQw4w9WgXcQ" },
        { id: "11111111-1111-4111-8111-111111111111", title: "Two", published: false, body: emptyBody(), videoUrl: null }] }],
    });
    // With levels, sections are sent inside their level.
    const levels = [{ key: "v1", id: "22222222-2222-4222-8222-222222222222", title: "Module" }];
    expect(draftPayload("course", form({ levels, sections: [{ ...sections[0], level: "v1" }], lessons: [second] }))).toMatchObject({
      levels: [{ id: levels[0].id, title: "Module", sections: [{ title: "Week one", lessons: [{ title: "Two" }] }] }] });
    expect(draftPayload("course", form())).toMatchObject({ sections: [] });
    expect(draftPayload("download", form({ fileIds: ["a", "b"] }))).toEqual({ kind: "download", title: "Basics", slug: "basics", summary: "", visibility: "unlisted", fileIds: ["a", "b"] });
    expect(draftPayload("download", form())).not.toHaveProperty("lessons");
  });
  it("reports what stops a save", () => {
    expect(problems("course", form())).toEqual([]);
    expect(problems("course", form({ title: " ", slug: "x" }))).toEqual(["title", "address"]);
    expect(problems("course", form({ lessons: [newLesson()] }))).toEqual(["lessonTitle"]);
    expect(problems("download", form({ lessons: [newLesson()] }))).toEqual([]);
    expect(problems("course", form({ lessons: [{ ...newLesson(), title: "A", videoUrl: "javascript:alert(1)" }] }))).toEqual(["videoLink"]);
    expect(problems("course", form({ lessons: [{ ...newLesson(), title: "A", videoUrl: "https://youtu.be/dQw4w9WgXcQ" }] }))).toEqual([]);
    expect(problems("course", form({ labels: { level: "x".repeat(25), section: "", lesson: "" } }))).toEqual(["label"]);
    for (const slug of ["ab", "-ab", "ab-", "A-b-c", `a${"b".repeat(60)}`]) expect(problems("course", form({ slug })), slug).toContain("address");
  });
  it("follows the title for the address until it is edited, and never after publishing", () => {
    expect(nextAddress("old", "Bible Basics!", true)).toBe("bible-basics");
    expect(nextAddress("custom", "Bible Basics", false)).toBe("custom");
    expect(addressFollowsTitle({ title: "Bible Basics", slug: "bible-basics", state: "draft" })).toBe(true);
    expect(addressFollowsTitle({ title: "Bible Basics", slug: "bible-basics", state: "published" })).toBe(false);
    expect(addressFollowsTitle({ title: "Bible Basics", slug: "mine", state: "draft" })).toBe(false);
  });
  it("reorders without mutating and ignores impossible moves", () => {
    const list = ["a", "b", "c"];
    expect(move(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(move(list, 0, -1)).toEqual(list);
    expect(move(list, 3, 0)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
  it("mirrors the server publish rules in the checklist", () => {
    const done = (items: ReturnType<typeof publishChecklist>) => Object.fromEntries(items.map((check) => [check.id, check.done]));
    expect(done(publishChecklist("course", form({ visibility: "hidden", lessons: [{ ...newLesson(), published: false }] }), []))).toEqual({ title: true, address: true, lessons: false });
    expect(done(publishChecklist("course", form({ lessons: [{ ...newLesson(), published: true }] }), []))).toMatchObject({ lessons: true });
    expect(publishChecklist("download", form({ fileIds: [] }), [file("ready")]).at(-1)).toEqual({ id: "files", done: false });
    expect(publishChecklist("download", form({ fileIds: ["f1"] }), [file("ready")]).at(-1)).toEqual({ id: "files", done: true });
    // Every chosen file must be ready and private.
    expect(publishChecklist("download", form({ fileIds: ["f1", "f2"] }), [file("ready"), file("uploaded", "f2")]).at(-1)?.done).toBe(false);
    expect(publishChecklist("download", form({ fileIds: ["f1"] }), [file("ready", "f1", "public")]).at(-1)?.done).toBe(false);
    expect(publishChecklist("download", form({ fileIds: ["f1"] }), [file("quarantined")]).at(-1)?.done).toBe(false);
  });
  it("sends a failed check to the step that fixes it", () => {
    expect(["title", "address", "lessons", "files"].map((id) => stepOfCheck(id as never))).toEqual(["details", "details", "content", "content"]);
  });
  it("reads an item into a form, with a member's metadata-only read as an empty one", () => {
    const item = { title: "T", slug: "tt", summary: "S", visibility: "listed" as const, fileIds: undefined, labels: { level: null, section: "Week", lesson: null },
      sections: [{ id: "s1", levelId: null, title: "" }], lessons: [{ id: "l1", title: "One", body: emptyBody(), published: true, sectionId: "s1", video: { provider: "vk" as const, id: "-1_2" } }] };
    expect(formFromItem(item)).toEqual({ title: "T", slug: "tt", summary: "S", visibility: "listed", levels: [], sections: [{ key: "s1", id: "s1", title: "", level: null }],
      lessons: [{ key: "l1", id: "l1", title: "One", published: true, body: emptyBody(), section: "s1", videoUrl: "https://vkvideo.ru/video-1_2" }],
      labels: { level: "", section: "Week", lesson: "" }, fileIds: [] });
    expect(formFromItem({ title: "T", slug: "tt", summary: "", visibility: "hidden" }).lessons).toEqual([]);
    // A read without sections still keeps its lessons in one new untitled section.
    const legacy = formFromItem({ title: "T", slug: "tt", summary: "", visibility: "hidden", lessons: [{ id: "l1", title: "One", body: emptyBody(), published: true }] });
    expect(legacy.sections).toEqual([{ key: "section-loose", title: "", level: null }]);
    expect(draftPayload("course", legacy)).toMatchObject({ sections: [{ title: "", lessons: [{ id: "l1" }] }] });
  });
  it("names public pages by kind and gives file sizes as units", () => {
    expect(publicPath("course", "a-b")).toBe("/courses/a-b");
    expect(publicPath("download", "a-b")).toBe("/products/a-b");
    expect(fileSize(900)).toEqual({ value: 900, unit: "byte" });
    expect(fileSize(2048)).toEqual({ value: 2, unit: "kilobyte" });
    expect(fileSize(3 * 1024 * 1024)).toEqual({ value: 3, unit: "megabyte" });
  });
});
