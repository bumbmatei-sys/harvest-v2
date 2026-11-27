// Course structure (0130): optional levels, each holding sections, and every lesson in a section. The editor keeps three flat lists in course
// order (levels, sections, lessons) linked by keys; these pure helpers keep that order consistent and implement the up and down moves, which also
// carry a lesson into the neighbouring section (and a section into the neighbouring level) at the edges. The server checks everything again.
export const maxLevels = 10, maxSections = 50, maxCourseLessons = 50, labelLimit = 24;
export type LabelKind = "level" | "section" | "lesson";
export const labelKinds: readonly LabelKind[] = ["level", "section", "lesson"];
/** A course's own names. Null (or empty in the form) is the default name. */
export type CourseLabels = Record<LabelKind, string | null>;

const control = /[\u0000-\u001f\u007f]/;
/** A label is optional; when set it is 1 to 24 characters after trimming, with no control characters. */
export function validLabel(value: string) {
  const text = value.trim();
  return text.length <= labelLimit && !control.test(text);
}
/** The label to show: the course's own, or the default. */
export const labelOr = (value: string | null | undefined, fallback: string) => value?.trim() || fallback;

export type LevelForm = { key: string; id?: string; title: string };
export type SectionForm = { key: string; id?: string; title: string; level: string | null };
export type StructureLesson = { key: string; section: string };
export type Structure<L extends StructureLesson> = { levels: LevelForm[]; sections: SectionForm[]; lessons: L[] };

let counter = 0;
export const partKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

/** Sorts sections by their level's order and lessons by their section's order, keeping the order inside each group. */
export function ordered<L extends StructureLesson>(value: Structure<L>): Structure<L> {
  const levelAt = new Map(value.levels.map((row, index) => [row.key, index]));
  const sections = value.levels.length
    ? value.sections.map((row, index) => ({ row, index })).sort((a, b) => ((levelAt.get(a.row.level ?? "") ?? 0) - (levelAt.get(b.row.level ?? "") ?? 0)) || a.index - b.index).map(({ row }) => row)
    : value.sections.map((row) => ({ ...row, level: null }));
  const sectionAt = new Map(sections.map((row, index) => [row.key, index]));
  const lessons = value.lessons.map((row, index) => ({ row, index }))
    .sort((a, b) => ((sectionAt.get(a.row.section) ?? 0) - (sectionAt.get(b.row.section) ?? 0)) || a.index - b.index).map(({ row }) => row);
  return { levels: value.levels, sections, lessons };
}

function swap<T>(list: readonly T[], a: number, b: number) {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Whether a lesson can move: within its section, or into the previous or next section. */
export function canMoveLesson<L extends StructureLesson>(value: Structure<L>, key: string, direction: -1 | 1) {
  const index = value.lessons.findIndex((row) => row.key === key);
  if (index < 0) return false;
  const neighbour = value.lessons[index + direction];
  if (neighbour?.section === value.lessons[index].section) return true;
  const at = value.sections.findIndex((row) => row.key === value.lessons[index].section);
  return at + direction >= 0 && at + direction < value.sections.length;
}
/** Moves a lesson one place up or down; at the edge of its section it moves to the end of the previous section or the start of the next one. */
export function moveLesson<L extends StructureLesson>(value: Structure<L>, key: string, direction: -1 | 1): Structure<L> {
  if (!canMoveLesson(value, key, direction)) return value;
  const index = value.lessons.findIndex((row) => row.key === key), lesson = value.lessons[index];
  if (value.lessons[index + direction]?.section === lesson.section) return { ...value, lessons: swap(value.lessons, index, index + direction) };
  const at = value.sections.findIndex((row) => row.key === lesson.section), target = value.sections[at + direction].key;
  const rest = value.lessons.filter((row) => row.key !== key), moved = { ...lesson, section: target };
  // Into the previous section: after its last lesson. Into the next one: before its first lesson. `ordered` places it in the target group.
  const lessons = direction < 0 ? [...rest, moved] : [moved, ...rest];
  return ordered({ ...value, lessons });
}

/** Whether a section can move: within its level, or into the previous or next level. */
export function canMoveSection<L extends StructureLesson>(value: Structure<L>, key: string, direction: -1 | 1) {
  const index = value.sections.findIndex((row) => row.key === key);
  if (index < 0) return false;
  const neighbour = value.sections[index + direction];
  if (neighbour && neighbour.level === value.sections[index].level) return true;
  if (!value.levels.length) return false;
  const at = value.levels.findIndex((row) => row.key === value.sections[index].level);
  return at + direction >= 0 && at + direction < value.levels.length;
}
export function moveSection<L extends StructureLesson>(value: Structure<L>, key: string, direction: -1 | 1): Structure<L> {
  if (!canMoveSection(value, key, direction)) return value;
  const index = value.sections.findIndex((row) => row.key === key), section = value.sections[index];
  if (value.sections[index + direction]?.level === section.level) return ordered({ ...value, sections: swap(value.sections, index, index + direction) });
  const at = value.levels.findIndex((row) => row.key === section.level), target = value.levels[at + direction].key;
  const rest = value.sections.filter((row) => row.key !== key), moved = { ...section, level: target };
  return ordered({ ...value, sections: direction < 0 ? [...rest, moved] : [moved, ...rest] });
}
export function moveLevel<L extends StructureLesson>(value: Structure<L>, key: string, direction: -1 | 1): Structure<L> {
  const index = value.levels.findIndex((row) => row.key === key);
  if (index < 0 || index + direction < 0 || index + direction >= value.levels.length) return value;
  return ordered({ ...value, levels: swap(value.levels, index, index + direction) });
}

/** Adds a level. The first level takes every existing section, so a course is either all in levels or has none. */
export function addLevel<L extends StructureLesson>(value: Structure<L>, level: LevelForm): Structure<L> {
  if (value.levels.length >= maxLevels) return value;
  const first = value.levels.length === 0;
  return ordered({ ...value, levels: [...value.levels, level], sections: first ? value.sections.map((row) => ({ ...row, level: level.key })) : value.sections });
}
/** Removes a level; its sections join the previous level (or the next one), and with the last level gone the sections stand alone. */
export function removeLevel<L extends StructureLesson>(value: Structure<L>, key: string): Structure<L> {
  const index = value.levels.findIndex((row) => row.key === key);
  if (index < 0) return value;
  const levels = value.levels.filter((row) => row.key !== key), heir = levels[Math.max(0, index - 1)]?.key ?? null;
  return ordered({ ...value, levels, sections: value.sections.map((row) => (row.level === key ? { ...row, level: heir } : row)) });
}
/** Adds a section at the end of a level (or of the course). */
export function addSection<L extends StructureLesson>(value: Structure<L>, section: SectionForm): Structure<L> {
  if (value.sections.length >= maxSections) return value;
  const level = value.levels.length ? section.level ?? value.levels[value.levels.length - 1].key : null;
  return ordered({ ...value, sections: [...value.sections, { ...section, level }] });
}
/** A section can be removed when it holds no lesson, or when another section can take its lessons. */
export const canRemoveSection = <L extends StructureLesson>(value: Structure<L>, key: string) =>
  value.sections.length > 1 || !value.lessons.some((row) => row.section === key);
/** Removes a section; its lessons join the previous section (or the next one). */
export function removeSection<L extends StructureLesson>(value: Structure<L>, key: string): Structure<L> {
  const index = value.sections.findIndex((row) => row.key === key);
  if (index < 0 || !canRemoveSection(value, key)) return value;
  const sections = value.sections.filter((row) => row.key !== key), heir = sections[Math.max(0, index - 1)]?.key;
  return ordered({ ...value, sections, lessons: value.lessons.map((row) => (row.section === key && heir ? { ...row, section: heir } : row)) });
}
/** Adds a lesson at the end of a section. With no section yet, it first adds an untitled one (a course without sections, as before 0130). */
export function addLesson<L extends StructureLesson>(value: Structure<L>, lesson: L, section?: string): Structure<L> {
  if (value.lessons.length >= maxCourseLessons) return value;
  let next = value;
  if (!next.sections.length) next = addSection(next, { key: partKey("section"), title: "", level: null });
  const target = section ?? next.sections[next.sections.length - 1].key;
  return ordered({ ...next, lessons: [...next.lessons, { ...lesson, section: target }] });
}
/** Whether the editor shows section and level headings: not for a course that is one untitled section, which reads as a plain lesson list. */
export const showsStructure = <L extends StructureLesson>(value: Structure<L>) =>
  value.levels.length > 0 || value.sections.length > 1 || value.sections.some((row) => row.title.trim() !== "");
