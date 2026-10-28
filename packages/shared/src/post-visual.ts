import { z } from "zod";
import { containsLink } from "./cta.js";

/*
 * The picture published with a post, as content rather than decoration.
 *
 * The first version put the post's headline on a block of brand colour, which
 * says nothing a reader did not already get from the first line of the post.
 * A graphic earns its room in the feed when it shows the idea: the steps, the
 * before and after, the one number, the checklist. So the writer describes the
 * picture as structure drawn from the post (`PostVisual`), the checks below
 * hold it to the post's own words, and `drawPostGraphic` draws it.
 *
 * Every line is short enough to set large and read on a phone. Nothing in it
 * may be a number the post does not state: a statistic set in 200-point type
 * is the most quoted thing in the post, and an invented one reaches the rep's
 * whole network under their own name.
 */

export const VISUAL_KINDS = ["steps", "compare", "stat", "checklist", "flow", "quote"] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const VISUAL_KIND_LABEL: Record<VisualKind, string> = {
  steps: "Steps, numbered",
  compare: "Two sides compared",
  stat: "One number that matters",
  checklist: "A checklist",
  flow: "How one thing leads to the next",
  quote: "The key line, framed",
};

export interface PostVisual {
  kind: VisualKind;
  title: string;
  items: Array<{ label: string; detail: string | null }>;
  stat: { value: string; caption: string } | null;
  columns: Array<{ heading: string; points: string[] }> | null;
}

/** Model-facing: every key present, nullable rather than optional. */
export const PostVisualSchema = z.object({
  kind: z.enum(VISUAL_KINDS),
  title: z.string().max(90).describe("The picture's title, 90 characters at most."),
  items: z
    .array(z.object({ label: z.string().max(48), detail: z.string().max(90).nullable() }))
    .max(5)
    .describe("For steps, checklist and flow: 3 to 5 short lines, in order. Empty otherwise."),
  stat: z
    .object({ value: z.string().max(12), caption: z.string().max(90) })
    .nullable()
    .describe("For stat only: a number the post itself states, and what it measures."),
  columns: z
    .array(z.object({ heading: z.string().max(30), points: z.array(z.string().max(60)).max(4) }))
    .nullable()
    .describe("For compare only: exactly two columns, each with 2 to 4 short points."),
});

const LIMITS = { title: 90, label: 48, detail: 90, heading: 30, point: 60, value: 12, caption: 90 } as const;

const COUNTS: Partial<Record<VisualKind, [number, number]>> = {
  steps: [3, 5],
  checklist: [3, 5],
  flow: [3, 4],
};

function textProblems(where: string, text: string, max: number): string[] {
  const out: string[] = [];
  const value = text.trim();
  if (!value) return [`${where} is empty.`];
  if (value.length > max) out.push(`${where} is ${value.length} characters; keep it to ${max}.`);
  if (/[–—]|\s-\s/.test(value)) out.push(`${where} has a dash. Use a full stop or a comma.`);
  if (/\p{Extended_Pictographic}/u.test(value)) out.push(`${where} has an emoji.`);
  if (/#\w/.test(value)) out.push(`${where} has a hashtag.`);
  if (containsLink(value) || /\b[a-z0-9-]+\.(com|io|co|net|org|ai|app)\b/i.test(value)) {
    out.push(`${where} has a link.`);
  }
  if (/\{\{|\[[A-Z][a-z]+\]/.test(value)) out.push(`${where} has a placeholder.`);
  return out;
}

/** Every number written in a piece of text, as digits only ("41%" → "41"). */
function numbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, ""));
}

function allText(visual: PostVisual): string[] {
  return [
    visual.title,
    ...visual.items.flatMap((item) => [item.label, item.detail ?? ""]),
    ...(visual.stat ? [visual.stat.value, visual.stat.caption] : []),
    ...(visual.columns ?? []).flatMap((column) => [column.heading, ...column.points]),
  ];
}

/**
 * What is wrong with a visual, as sentences a writer or a person can act on.
 * Empty when it may be drawn. `postBody` is the post it illustrates, which is
 * where every number on it has to come from.
 */
export function visualProblems(visual: PostVisual, postBody: string): string[] {
  const problems = textProblems("The title", visual.title, LIMITS.title);
  visual.items.forEach((item, i) => {
    problems.push(...textProblems(`Line ${i + 1}`, item.label, LIMITS.label));
    if (item.detail?.trim()) problems.push(...textProblems(`Line ${i + 1}'s detail`, item.detail, LIMITS.detail));
  });

  const range = COUNTS[visual.kind];
  if (range && (visual.items.length < range[0] || visual.items.length > range[1])) {
    problems.push(`A ${visual.kind} picture needs ${range[0]} to ${range[1]} lines; it has ${visual.items.length}.`);
  }
  if (visual.kind === "stat") {
    if (!visual.stat) problems.push("A number picture needs the number and what it measures.");
    else {
      problems.push(...textProblems("The number", visual.stat.value, LIMITS.value));
      problems.push(...textProblems("The number's caption", visual.stat.caption, LIMITS.caption));
      if (!/\d/.test(visual.stat.value)) problems.push("The number has no digits in it.");
    }
  }
  if (visual.kind === "compare") {
    const columns = visual.columns ?? [];
    if (columns.length !== 2) problems.push("A comparison needs exactly two sides.");
    columns.forEach((column, i) => {
      problems.push(...textProblems(`Side ${i + 1}'s heading`, column.heading, LIMITS.heading));
      if (column.points.length < 2 || column.points.length > 4) {
        problems.push(`Side ${i + 1} needs 2 to 4 points; it has ${column.points.length}.`);
      }
      column.points.forEach((point, j) => problems.push(...textProblems(`Side ${i + 1}, point ${j + 1}`, point, LIMITS.point)));
    });
  }

  // No number the post does not state.
  const stated = new Set(numbers(postBody));
  const invented = [...new Set(allText(visual).flatMap(numbers))].filter((n) => !stated.has(n));
  if (invented.length) {
    problems.push(`The picture shows ${invented.join(", ")}, which the post does not say. Use only the post's own numbers.`);
  }
  return problems;
}

/**
 * A stored or model-written visual, read leniently: anything that is not a
 * visual comes back as null rather than throwing, so one malformed row never
 * takes the posts page down.
 */
export function readVisual(title: string | null | undefined, spec: unknown): PostVisual | null {
  if (!title?.trim()) return null;
  // A post from before pictures had structure carries a headline only, which
  // is drawn as its key line framed.
  if (spec === null || spec === undefined) return { kind: "quote", title: title.trim(), items: [], stat: null, columns: null };
  if (typeof spec !== "object") return null;
  const raw = spec as Record<string, unknown>;
  const kind = VISUAL_KINDS.includes(raw.kind as VisualKind) ? (raw.kind as VisualKind) : null;
  if (!kind) return null;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const items = Array.isArray(raw.items)
    ? raw.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ label: str(item.label), detail: str(item.detail) || null }))
        .filter((item) => item.label.trim())
    : [];
  const statRaw = raw.stat && typeof raw.stat === "object" ? (raw.stat as Record<string, unknown>) : null;
  const columns = Array.isArray(raw.columns)
    ? raw.columns
        .filter((column): column is Record<string, unknown> => Boolean(column) && typeof column === "object")
        .map((column) => ({
          heading: str(column.heading),
          points: Array.isArray(column.points) ? column.points.map(str).filter((p) => p.trim()) : [],
        }))
    : null;
  return {
    kind,
    title: title.trim(),
    items,
    stat: statRaw ? { value: str(statRaw.value), caption: str(statRaw.caption) } : null,
    columns,
  };
}

/** The part stored beside the title (`linkedin_posts.graphic_spec`). */
export function visualSpec(visual: PostVisual): Omit<PostVisual, "title"> {
  const { title: _title, ...spec } = visual;
  return spec;
}

/**
 * A visual as lines a person can edit in one box, and back.
 *
 * steps, checklist, flow: one line each, "label: detail" or just "label".
 * compare: first line the two headings, then one line per point, each split
 * with " | ". stat: "value | caption". quote: no lines.
 */
export function visualToLines(visual: PostVisual): string {
  switch (visual.kind) {
    case "compare": {
      const [a, b] = visual.columns ?? [];
      const rows = Math.max(a?.points.length ?? 0, b?.points.length ?? 0);
      return [
        `${a?.heading ?? ""} | ${b?.heading ?? ""}`,
        ...Array.from({ length: rows }, (_, i) => `${a?.points[i] ?? ""} | ${b?.points[i] ?? ""}`),
      ].join("\n");
    }
    case "stat":
      return visual.stat ? `${visual.stat.value} | ${visual.stat.caption}` : "";
    case "quote":
      return "";
    default:
      return visual.items.map((item) => (item.detail ? `${item.label}: ${item.detail}` : item.label)).join("\n");
  }
}

export function visualFromLines(kind: VisualKind, title: string, text: string): PostVisual {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const base: PostVisual = { kind, title: title.trim(), items: [], stat: null, columns: null };
  if (kind === "compare") {
    const split = (line: string) => line.split("|").map((part) => part.trim());
    const [head, ...rows] = lines;
    const [left = "", right = ""] = head ? split(head) : [];
    return {
      ...base,
      columns: [
        { heading: left, points: rows.map((row) => split(row)[0] ?? "").filter(Boolean) },
        { heading: right, points: rows.map((row) => split(row)[1] ?? "").filter(Boolean) },
      ],
    };
  }
  if (kind === "stat") {
    const [value = "", ...rest] = (lines[0] ?? "").split("|").map((part) => part.trim());
    return { ...base, stat: lines[0] ? { value, caption: rest.join(" | ") } : null };
  }
  if (kind === "quote") return base;
  return {
    ...base,
    items: lines.map((line) => {
      const at = line.indexOf(":");
      return at > 0
        ? { label: line.slice(0, at).trim(), detail: line.slice(at + 1).trim() || null }
        : { label: line, detail: null };
    }),
  };
}
