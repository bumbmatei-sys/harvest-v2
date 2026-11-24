// Starter templates written for Harvest (original content). They live in code, are read by everyone and are applied like a ministry's own templates.
import type { DocContent, DocNode, TemplateCategory, TemplatePage } from "./docs";

const text = (value: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const p = (value = ""): DocNode => value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" };
const h = (level: number, value: string): DocNode => ({ type: "heading", attrs: { level }, content: [text(value)] });
const bullets = (items: string[]): DocNode => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const tasks = (items: string[]): DocNode => ({ type: "taskList", content: items.map((i) => ({ type: "taskItem", attrs: { checked: false }, content: [p(i)] })) });
const banner = (tone: string, value: string): DocNode => ({ type: "callout", attrs: { tone }, content: [p(value)] });
const table = (head: string[], rows: string[][]): DocNode => ({ type: "table", content: [
  { type: "tableRow", content: head.map((c) => ({ type: "tableHeader", content: [p(c)] })) }, ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => ({ type: "tableCell", content: [p(c)] })) }))] });
const doc = (...content: DocNode[]): DocContent => ({ type: "doc", content });

export type StarterTemplate = { slug: string; name: string; category: TemplateCategory; description: string; pages: TemplatePage[] };
export const starterTemplates: readonly StarterTemplate[] = [
  { slug: "meeting-notes", name: "Meeting notes", category: "meetings", description: "Agenda, notes, decisions and action items for a team meeting.", pages: [{ title: "Meeting notes", parent: null, content: doc(
    h(2, "Details"), bullets(["Date and time:", "Attendees:", "Facilitator:"]), h(2, "Agenda"), tasks(["Opening prayer", "Updates", "Discussion", "Next steps"]),
    h(2, "Notes"), p(), h(2, "Decisions"), bullets(["" + "Decision and who made it"]), h(2, "Action items"), tasks(["Action, owner and date"])) }] },
  { slug: "sermon-notes", name: "Sermon notes", category: "worship", description: "A preparation outline for a message: passage, main idea, outline and application.", pages: [{ title: "Sermon notes", parent: null, content: doc(
    h(2, "Passage"), p(), h(2, "Main idea"), banner("info", "One sentence the listener should remember."), h(2, "Outline"),
    { type: "orderedList", content: ["Point one", "Point two", "Point three"].map((i) => ({ type: "listItem", content: [p(i)] })) }, h(2, "Illustrations and stories"), p(), h(2, "Application"), bullets(["For individuals", "For families", "For our ministry"]), h(2, "Closing prayer"), p()) }] },
  { slug: "service-run-sheet", name: "Service run sheet", category: "worship", description: "A timed order of service with who is responsible for each part.", pages: [{ title: "Service run sheet", parent: null, content: doc(
    p("Service date:"), table(["Time", "Item", "Who", "Notes"], [["9:30", "Welcome and announcements", "", ""], ["9:40", "Worship", "", ""], ["10:10", "Message", "", ""], ["10:50", "Prayer and response", "", ""], ["11:00", "Dismissal", "", ""]]),
    h(2, "Reminders"), tasks(["Slides ready", "Sound check done", "Welcome team in place"])) }] },
  { slug: "event-plan", name: "Event plan", category: "events", description: "Goal, team, budget and a timeline for a ministry event.", pages: [
    { title: "Event plan", parent: null, content: doc(h(2, "Goal"), p(), h(2, "Date and place"), bullets(["Date:", "Place:", "Expected people:"]), h(2, "Team"), table(["Role", "Name", "Contact"], [["Lead", "", ""], ["Hospitality", "", ""], ["Setup and cleanup", "", ""]]), h(2, "Timeline"), tasks(["Choose a date", "Book the space", "Invite people", "Confirm volunteers", "Run the event", "Thank the team"])) },
    { title: "Budget", parent: 0, content: doc(table(["Item", "Planned", "Actual"], [["Food", "", ""], ["Supplies", "", ""], ["Printing", "", ""]]), p("Total:")) }] },
  { slug: "volunteer-onboarding", name: "Volunteer onboarding", category: "people", description: "A welcome and first steps for a new volunteer.", pages: [{ title: "Volunteer onboarding", parent: null, content: doc(
    banner("success", "Thank you for serving. This page walks you through your first weeks."), h(2, "First steps"), tasks(["Meet your team lead", "Read the safety and care guidelines", "Shadow a service", "Share your availability"]),
    h(2, "Who to ask"), table(["Question about", "Person", "How to reach them"], [["Schedule", "", ""], ["Training", "", ""], ["Care and safety", "", ""]]), h(2, "Notes"), p()) }] },
  { slug: "project-brief", name: "Project brief", category: "planning", description: "Goal, scope, milestones and risks for a ministry project.", pages: [{ title: "Project brief", parent: null, content: doc(
    h(2, "Goal"), p(), h(2, "Scope"), bullets(["In scope", "Out of scope"]), h(2, "Milestones"), table(["Milestone", "Owner", "Due"], [["", "", ""], ["", "", ""]]), h(2, "Risks"), bullets(["Risk and what we will do about it"]), h(2, "Decisions needed"), tasks(["Decision and who decides"])) }] },
];
export const starterBySlug = (slug: string) => starterTemplates.find((t) => t.slug === slug);
