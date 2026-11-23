import { defaultBrand, richParagraphs, type BrandKit, type EmailBlock, type EmailDocument } from "./blocks";
import type { RichDoc } from "../rich-text";

export const templateIds = ["weekly-update", "event-invite", "prayer-praise", "sermon-recap", "fundraising-appeal", "welcome", "seasonal-greeting", "digest"] as const;
export type TemplateId = (typeof templateIds)[number];

const hello = "Hello {{firstName}},";
const doc = (...paragraphs: string[]): RichDoc => richParagraphs(...paragraphs);
const heading = (text: string): RichDoc => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] }] });
const list = (items: string[]): RichDoc => ({ type: "doc", content: [{ type: "bulletList", content: items.map(item => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: item }] }] })) }] });
const head = (id: string): EmailBlock => ({ id, type: "header", title: "{{ministryName}}", showLogo: true, align: "left" });
const text = (id: string, rich: RichDoc): EmailBlock => ({ id, type: "text", doc: rich });
const foot = (id: string, note: string): EmailBlock => ({ id, type: "footer", note });

const blocksFor: Record<TemplateId, () => EmailBlock[]> = {
  "weekly-update": () => [head("wu-head"),
    { id: "wu-hero", type: "hero", imageUrl: "", alt: "", heading: "This week at {{ministryName}}", text: "A short note on what is ahead, who we are praying for, and how to take part.", buttonLabel: "See what is on", buttonUrl: "" },
    text("wu-intro", doc(hello, "Thank you for being part of our community. Here is a quick look at the days ahead.")),
    { id: "wu-cols", type: "columns", leftHeading: "Sunday gathering", leftText: "Doors open at 9:30. Worship begins at 10:00, with children's activities running alongside.", rightHeading: "Midweek", rightText: "Prayer on Wednesday evening and small groups across the week. Ask us to connect you." },
    { id: "wu-quote", type: "quote", text: "Let us not grow weary of doing good, for in due season we will reap.", cite: "Galatians 6:9" },
    { id: "wu-event", type: "event", title: "Community lunch", date: "Sunday", time: "12:00", location: "Fellowship hall", buttonLabel: "Let us know you are coming", buttonUrl: "" },
    foot("wu-foot", "With gratitude,\n{{ministryName}}")],
  "event-invite": () => [head("ei-head"),
    { id: "ei-hero", type: "hero", imageUrl: "", alt: "", heading: "You are invited", text: "Join us for an evening of worship, a shared meal and time together.", buttonLabel: "Reserve your place", buttonUrl: "" },
    { id: "ei-event", type: "event", title: "Autumn celebration evening", date: "Saturday, 14 November", time: "6:00 pm", location: "Main hall, doors open at 5:30", buttonLabel: "Reserve your place", buttonUrl: "" },
    text("ei-body", doc(hello, "We would love to see you and your family. Bring a friend, and a dish to share if you can.")),
    { id: "ei-cols", type: "columns", leftHeading: "What to expect", leftText: "Music, a short message, and plenty of time to talk over supper.", rightHeading: "Good to know", rightText: "Parking at the rear. Childcare is available for the under-fives." },
    { id: "ei-div", type: "divider" }, foot("ei-foot", "Questions? Simply reply to this email.")],
  "prayer-praise": () => [head("pp-head"),
    { id: "pp-hero", type: "hero", imageUrl: "", alt: "", heading: "Prayer and praise", text: "Thank you for standing with us. Here is what we are giving thanks for and where we ask for your prayers.", buttonLabel: "", buttonUrl: "" },
    text("pp-praise", { type: "doc", content: [...heading("Praise").content, ...list(["A full house at the family service", "Two new small groups have started", "Provision for the roof repairs"]).content] }),
    { id: "pp-quote", type: "quote", text: "Give thanks in all circumstances; for this is God's will for you.", cite: "1 Thessalonians 5:18" },
    text("pp-pray", { type: "doc", content: [...heading("Prayer requests").content, ...list(["Wisdom for our leadership team", "Families facing difficult seasons", "Our outreach week in the spring"]).content] }),
    { id: "pp-give", type: "giving", heading: "Share a request", text: "Reply to this email and we will pray with you.", buttonLabel: "", buttonUrl: "" },
    foot("pp-foot", "In Christ,\n{{ministryName}}")],
  "sermon-recap": () => [head("sr-head"),
    { id: "sr-hero", type: "hero", imageUrl: "", alt: "", heading: "Sunday's message, in short", text: "Missed it, or want to go deeper? Here is the heart of it and a few questions for the week.", buttonLabel: "Watch or listen", buttonUrl: "" },
    { id: "sr-quote", type: "quote", text: "Your word is a lamp to my feet and a light to my path.", cite: "Psalm 119:105" },
    text("sr-points", { type: "doc", content: [...heading("Three things to remember").content, ...list(["God speaks, and we are invited to listen", "Small steps of obedience matter", "We walk this out together"]).content] }),
    { id: "sr-video", type: "video", thumbnailUrl: "", alt: "", videoUrl: "", caption: "Watch the full message" },
    text("sr-ask", doc("For your group this week: where have you noticed God leading you, and what is one step you can take?")),
    { id: "sr-social", type: "social", links: [{ label: "Website", url: "" }, { label: "Podcast", url: "" }] }, foot("sr-foot", "")],
  "fundraising-appeal": () => [head("fa-head"),
    { id: "fa-hero", type: "hero", imageUrl: "", alt: "", heading: "Help us finish what we started", text: "Together we are close to our goal. Your gift this month makes the next step possible.", buttonLabel: "Give today", buttonUrl: "" },
    text("fa-story", doc(hello, "Over the past year, your generosity has helped us serve more families than ever. This season we are raising support for our community outreach and the space to host it.")),
    { id: "fa-cols", type: "columns", leftHeading: "What it funds", leftText: "Meals, mentoring and a safe place to meet every week.", rightHeading: "Where we are", rightText: "We have reached most of our goal. A final push gets us there." },
    { id: "fa-quote", type: "quote", text: "Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver.", cite: "2 Corinthians 9:7" },
    { id: "fa-give", type: "giving", heading: "Make a gift", text: "Every gift, large or small, is a part of this work. Thank you.", buttonLabel: "Give now", buttonUrl: "" },
    foot("fa-foot", "With deep thanks,\n{{ministryName}}")],
  "welcome": () => [head("wl-head"),
    { id: "wl-hero", type: "hero", imageUrl: "", alt: "", heading: "Welcome, {{firstName}}", text: "We are so glad you are here. Here is how to find your place in our community.", buttonLabel: "Plan your first visit", buttonUrl: "" },
    text("wl-body", doc("A few things to help you get started. There is no pressure and no expectation: come as you are.")),
    { id: "wl-cols", type: "columns", leftHeading: "Gather with us", leftText: "Sundays at 10:00. Arrive a little early for coffee and a friendly welcome.", rightHeading: "Get connected", rightText: "Small groups, volunteering and prayer. Tell us what interests you." },
    { id: "wl-it", type: "imageText", imageUrl: "", alt: "", heading: "Meet our team", text: "Our team would love to say hello. Reply to this email with any question and a real person will answer.", side: "left" },
    { id: "wl-social", type: "social", links: [{ label: "Website", url: "" }, { label: "Watch online", url: "" }] }, foot("wl-foot", "We are glad you are here.")],
  "seasonal-greeting": () => [head("sg-head"),
    { id: "sg-hero", type: "hero", imageUrl: "", alt: "", heading: "Peace and joy this season", text: "From all of us at {{ministryName}}, a heartfelt thank you for a year of faith, friendship and service.", buttonLabel: "See our services", buttonUrl: "" },
    { id: "sg-quote", type: "quote", text: "For unto us a child is born, unto us a son is given.", cite: "Isaiah 9:6" },
    text("sg-body", doc(hello, "As the season begins, we pray you are surrounded by loved ones and the quiet gift of rest. We would love to celebrate with you.")),
    { id: "sg-event", type: "event", title: "Candlelight service", date: "Christmas Eve", time: "7:00 pm", location: "Main sanctuary", buttonLabel: "Plan your visit", buttonUrl: "" },
    foot("sg-foot", "Blessings to you and yours,\n{{ministryName}}")],
  "digest": () => [head("dg-head"),
    text("dg-intro", { type: "doc", content: [...heading("The week in brief").content, ...doc(hello, "Four stories worth your time.").content] }),
    { id: "dg-one", type: "imageText", imageUrl: "", alt: "", heading: "Serving our neighbours", text: "Volunteers served over two hundred meals this week. See how you can help next time.", side: "left" },
    { id: "dg-two", type: "imageText", imageUrl: "", alt: "", heading: "Youth retreat registration", text: "Spaces are limited. Register this week to hold your place.", side: "right" },
    { id: "dg-cols", type: "columns", leftHeading: "Upcoming", leftText: "Sunday service, Wednesday prayer, Friday young adults.", rightHeading: "Reading", rightText: "This month we are reading through the Gospel of John together." },
    { id: "dg-div", type: "divider" },
    { id: "dg-social", type: "social", links: [{ label: "Website", url: "" }, { label: "Events", url: "" }, { label: "Give", url: "" }] }, foot("dg-foot", "")],
};

export function templateDocument(id: TemplateId, brand: BrandKit = defaultBrand): EmailDocument {
  return { version: 2, brand, blocks: blocksFor[id]() };
}

/** An empty email: header, one paragraph and a sign-off. */
export function blankDocument(brand: BrandKit = defaultBrand): EmailDocument {
  return { version: 2, brand, blocks: [head("bl-head"), text("bl-text", doc(hello, "")), foot("bl-foot", "")] };
}
