/**
 * Find the bug that cost every card its padding, everywhere it exists.
 *
 * `.card` is (0,1,0) and `.app-body > section` is (0,1,1), so the frame's
 * `padding-block: 0` beat the card's own `padding` on every card written as a
 * `<section>`. Neither rule looks wrong. They only collide, and the collision
 * is invisible in a diff of either one — which is why reading the stylesheet
 * found nothing and measuring the rendered card found it in one line.
 *
 * So this reads the markup rather than guessing: every (tag, classes) pair the
 * app actually renders, matched against every rule that could apply to it,
 * ranked by real CSS specificity. A property set twice on one element, where
 * the winner is not the most specific *component* rule, is reported.
 *
 * Conflicts between a base rule and a @media rule are skipped — that is a
 * breakpoint doing its job. Only rules in the same context can collide by
 * accident.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync("apps/web/src/app/globals.css", "utf8");

/* ------------------------------------------------------------------ parse */

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every rule in the sheet, tagged with the @media it sits in ("" for none). */
function rules(css) {
  const src = stripComments(css);
  const out = [];
  let i = 0;
  let media = "";
  let buffer = "";

  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const head = buffer.trim();
      buffer = "";
      if (head.startsWith("@")) {
        // A block at-rule: remember the condition and keep scanning inside it.
        media = head;
        i += 1;
        continue;
      }
      // A declaration block: take it whole.
      let depth = 1;
      let body = "";
      i += 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        body += src[i];
        i += 1;
      }
      for (const selector of head.split(",")) {
        const s = selector.trim();
        if (s) out.push({ selector: s, media, decls: declarations(body), order: out.length });
      }
      i += 1;
      continue;
    }
    if (ch === "}") {
      media = "";
      buffer = "";
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  return out;
}

function declarations(body) {
  const out = new Map();
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const prop = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!prop || prop.startsWith("--") || !value) continue;
    out.set(prop, value);
  }
  return out;
}

/* ------------------------------------------------------- specificity */

/** [ids, classes/attrs/pseudo-classes, elements/pseudo-elements]. */
function specificity(selector) {
  // `:not(x)` contributes its argument's specificity, not its own; `:where(x)`
  // contributes nothing at all, which is the whole reason the frame uses it.
  const flat = selector
    .replace(/:where\([^)]*\)/g, "")
    .replace(/:not\(([^)]*)\)/g, " $1 ");
  const ids = (flat.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (flat.match(/\.[\w-]+/g) ?? []).length +
    (flat.match(/\[[^\]]+\]/g) ?? []).length +
    (flat.match(/:(?!:)[\w-]+(\([^)]*\))?/g) ?? []).length;
  const elements =
    (flat.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length +
    (flat.match(/::[\w-]+/g) ?? []).length;
  return [ids, classes, elements];
}

const beats = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/* ------------------------------------------------------------- matching */

/** The rightmost compound — the part that has to match the element itself. */
function keyCompound(selector) {
  const parts = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  // `:where(.app-body) > section` still requires that ancestor to match; it
  // only stops it counting towards specificity.

  return parts[parts.length - 1] ?? "";
}

function parseCompound(compound) {
  const nots = [...compound.matchAll(/:not\(([^)]*)\)/g)].map((m) => m[1].trim());
  const bare = compound.replace(/:not\([^)]*\)/g, "");
  const classes = (bare.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1));
  const element = (bare.match(/^[a-zA-Z][\w-]*/) ?? [null])[0];
  const pseudo = /:(hover|focus|active|disabled|checked|first|last|nth|before|after|placeholder|is\(|has\()/.test(
    bare.replace(/^[^:]*/, ""),
  );
  return { classes, element, nots, pseudo };
}

/**
 * The frame every application screen sits inside. A rule whose ancestors are
 * only these is a rule a component cannot escape and cannot see coming — which
 * is the whole category of bug this script exists for. A rule with any other
 * ancestor (`.funnel > div`, `.meter.is-short > span`) applies only where that
 * ancestor is, and this script has no DOM tree to check that against, so it is
 * left alone rather than guessed at.
 */
const FRAME = new Set(["app", "app-body", "app-main", "app-aside"]);

/** Every compound left of the rightmost one. */
function ancestors(selector) {
  const parts = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return parts.slice(0, -1);
}

function isFrameScoped(selector) {
  const chain = ancestors(selector);
  if (chain.length === 0) return true; // the component speaking for itself
  return chain.every((compound) => {
    const inner = compound.replace(/^:where\(([^)]*)\)$/, "$1");
    const { classes, element } = parseCompound(inner);
    if (element && !["html", "body"].includes(element.toLowerCase())) return false;
    return classes.length > 0 && classes.every((c) => FRAME.has(c));
  });
}

/** Could this rule apply to <tag class="...">? */
function couldMatch(selector, tag, classList) {
  if (!isFrameScoped(selector)) return false;
  const { classes, element, nots, pseudo } = parseCompound(keyCompound(selector));
  if (pseudo) return false; // a state, not the resting style
  if (element && element.toLowerCase() !== tag.toLowerCase()) return false;
  if (!element && classes.length === 0) return false;
  for (const c of classes) if (!classList.includes(c)) return false;
  for (const n of nots) {
    const p = parseCompound(n);
    if (p.element && p.element.toLowerCase() === tag.toLowerCase()) return false;
    if (p.classes.length && p.classes.every((c) => classList.includes(c))) return false;
  }
  return true;
}

/* ---------------------------------------------------------- the markup */

function tsxFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Every (tag, classes) the app renders, with where it came from. */
function elements() {
  const seen = new Map();
  for (const file of tsxFiles("apps/web/src")) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/<([a-z][\w-]*)\s[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const tag = m[1];
      // A template literal contributes only its static class names.
      const raw = (m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
      const classes = raw.split(/\s+/).filter(Boolean);
      if (classes.length === 0) continue;
      const key = `${tag}.${classes.join(".")}`;
      if (!seen.has(key)) seen.set(key, { tag, classes, file });
    }
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------- report */

const ALL = rules(CSS);
const findings = [];

for (const el of elements()) {
  const matching = ALL.filter((r) => couldMatch(r.selector, el.tag, el.classes)).map((r) => ({
    ...r,
    spec: specificity(r.selector),
  }));
  if (matching.length < 2) continue;

  const byProp = new Map();
  for (const rule of matching) {
    for (const [prop, value] of rule.decls) {
      if (!byProp.has(prop)) byProp.set(prop, []);
      byProp.get(prop).push({ ...rule, prop, value });
    }
  }

  for (const [prop, set] of byProp) {
    // Same context only: a @media override of a base rule is a breakpoint.
    const groups = new Map();
    for (const r of set) {
      if (!groups.has(r.media)) groups.set(r.media, []);
      groups.get(r.media).push(r);
    }
    for (const [media, group] of groups) {
      if (group.length < 2) continue;
      if (new Set(group.map((g) => g.value)).size < 2) continue;

      const winner = group.reduce((a, b) =>
        beats(b.spec, a.spec) || (!beats(a.spec, b.spec) && b.order > a.order) ? b : a,
      );
      // A single-class rule is the component speaking for itself. When
      // something else outranks it on a property it also sets, that is the bug.
      const component = group.find((g) => /^\.[\w-]+$/.test(g.selector));
      if (!component || winner === component) continue;

      /*
       * A modifier beating its own base is the design system working:
       * `.btn.small` is meant to win over `.btn`, and `.btn[aria-disabled]`
       * over both. What is a bug is two *independent* classes on one element
       * fighting over a property, because then one of them silently does
       * nothing and the author cannot tell which — `<li class="card stack-2">`
       * asks for an 8px gap and gets the card's 16px, with `stack-2` reading
       * on screen as if it had been applied.
       */
      const base = component.selector.slice(1);
      if (winner.selector.includes(`.${base}`)) continue;

      findings.push({
        element: `<${el.tag} class="${el.classes.join(" ")}">`,
        file: el.file,
        prop,
        media,
        loser: `${component.selector} { ${prop}: ${component.value} }`,
        winner: `${winner.selector} { ${prop}: ${winner.value} }`,
        spec: `${winner.spec.join(",")} beats ${component.spec.join(",")}`,
      });
    }
  }
}

if (findings.length === 0) {
  console.log("no component rule is outranked on a property it sets");
  process.exit(0);
}

const byWinner = new Map();
for (const f of findings) {
  const key = `${f.winner} || ${f.loser}`;
  if (!byWinner.has(key)) byWinner.set(key, []);
  byWinner.get(key).push(f);
}

console.log(`${findings.length} collision(s), ${byWinner.size} distinct:\n`);
for (const [, group] of [...byWinner.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const f = group[0];
  console.log(`  ${f.prop}${f.media ? `  [${f.media}]` : ""}`);
  console.log(`    loses:  ${f.loser}`);
  console.log(`    to:     ${f.winner}    (${f.spec})`);
  console.log(`    on ${group.length} element(s), e.g. ${f.element}`);
  console.log(`      ${f.file}\n`);
}
process.exit(1);
