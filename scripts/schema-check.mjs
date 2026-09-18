#!/usr/bin/env node
/**
 * Do the migrations, the TypeScript row types, and (optionally) a live database
 * all describe the same schema?
 *
 * The migrations are what a fresh install runs. `packages/db/src/database.types.ts`
 * is what every query in this repo compiles against. Nothing has ever checked
 * that the two agree, and they cannot disagree loudly: a column in the types
 * that the database lacks type-checks perfectly and fails at runtime with
 * PostgREST's own error, in whichever screen happened to select it; a column in
 * the database that the types lack is simply invisible to every query here.
 *
 *   node scripts/schema-check.mjs
 *   node scripts/schema-check.mjs --live live.json
 *
 * `--live` takes the output of:
 *
 *   select table_name, string_agg(column_name, ',' order by column_name) as cols
 *   from information_schema.columns where table_schema = 'le'
 *   group by table_name;
 *
 * as JSON, which is how a deployment is checked against the repo that is
 * supposed to have produced it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "packages/db/supabase/migrations");
const typesFile = join(root, "packages/db/src/database.types.ts");

const liveFlag = process.argv.indexOf("--live");
const livePath = liveFlag === -1 ? null : process.argv[liveFlag + 1];

/** Column names per table, as the migrations leave them. */
function fromMigrations() {
  const tables = new Map();

  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    // Comments first, so a commented-out column never counts as one.
    const sql = readFileSync(join(migrationsDir, file), "utf8").replace(/--[^\n]*/g, "");

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let m;
    while ((m = createRe.exec(sql))) {
      const cols = new Set(tables.get(m[1]) ?? []);
      // Walk to the balanced closing paren rather than the next one: a column
      // list is full of `numeric(10,2)` and `check (x in (...))`.
      let depth = 1;
      let i = createRe.lastIndex;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "(") depth += 1;
        else if (sql[i] === ")") depth -= 1;
        i += 1;
      }

      for (const piece of splitTopLevel(sql.slice(createRe.lastIndex, i - 1))) {
        const t = piece.trim();
        if (!t) continue;
        const first = t.split(/\s+/)[0].toLowerCase();
        // Table-level constraints are not columns.
        if (["primary", "unique", "foreign", "check", "constraint", "exclude"].includes(first)) continue;
        cols.add(t.split(/\s+/)[0].replace(/"/g, ""));
      }
      tables.set(m[1], [...cols]);
    }

    // One `alter table` may carry several ADDs and DROPs, which is the form
    // these migrations use throughout.
    const alterRe = /alter\s+table\s+([a-z_][a-z0-9_]*)([^;]*);/gi;
    while ((m = alterRe.exec(sql))) {
      const cols = new Set(tables.get(m[1]) ?? []);
      for (const add of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
        cols.add(add[1]);
      }
      for (const drop of m[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
        cols.delete(drop[1]);
      }
      tables.set(m[1], [...cols]);
    }
  }

  return tables;
}

/** Split a column list on commas that are not inside parens or a quoted literal. */
function splitTopLevel(body) {
  const pieces = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        pieces.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  pieces.push(current);
  return pieces;
}

/** Column names per table, as database.types.ts declares them. */
function fromTypes() {
  const src = readFileSync(typesFile, "utf8");

  const rows = new Map();
  const rowRe = /export type (\w+Row) = \{([\s\S]*?)\n\};/g;
  let m;
  while ((m = rowRe.exec(src))) {
    const fields = [];
    // A field line, ignoring the doc comments between them.
    for (const line of m[2].split("\n")) {
      const field = line.match(/^\s{2}(\w+)(\??):/);
      if (field) fields.push(field[1]);
    }
    rows.set(m[1], fields);
  }

  const tables = new Map();
  const mapRe = /^\s{6}(\w+): Table<(\w+Row)>;/gm;
  while ((m = mapRe.exec(src))) {
    const fields = rows.get(m[2]);
    if (!fields) {
      console.log(`UNKNOWN  ${m[1]} maps to ${m[2]}, which is not declared in this file`);
      continue;
    }
    tables.set(m[1], fields);
  }
  return tables;
}

function compare(label, a, b, aName, bName) {
  let problems = 0;
  for (const [table, aCols] of a) {
    const bCols = b.get(table);
    if (!bCols) {
      // Not automatically a fault: the types deliberately omit tables this repo
      // only ever reaches through an RPC. Reported, never silent.
      console.log(`${label}  ${table}: in ${aName}, absent from ${bName}`);
      problems += 1;
      continue;
    }
    const missing = aCols.filter((c) => !bCols.includes(c));
    const extra = bCols.filter((c) => !aCols.includes(c));
    if (missing.length || extra.length) {
      problems += 1;
      console.log(`DRIFT  ${table}`);
      if (missing.length) console.log(`    only in ${aName}: ${missing.join(", ")}`);
      if (extra.length) console.log(`    only in ${bName}: ${extra.join(", ")}`);
    }
  }
  return problems;
}

const migrations = fromMigrations();
const types = fromTypes();

console.log(`${migrations.size} tables in the migrations, ${types.size} in database.types.ts\n`);

// Types against migrations, and not the reverse: a table the migrations create
// and the types leave out is a deliberate omission (platform_admins is reached
// only through is_platform_admin()), while a table the types declare and no
// migration creates is a query that cannot work.
let problems = compare("MISSING", types, migrations, "database.types.ts", "the migrations");

if (livePath) {
  const live = new Map(
    JSON.parse(readFileSync(livePath, "utf8")).map((r) => [r.table_name, r.cols.split(",")]),
  );
  console.log(`\n${live.size} tables live`);
  problems += compare("MISSING", live, migrations, "the live database", "the migrations");
  problems += compare("MISSING", migrations, live, "the migrations", "the live database");
}

console.log(
  problems === 0
    ? "\nNo drift."
    : `\n${problems} difference(s). A column the types declare and the database lacks fails at runtime, not at build.`,
);
process.exit(problems === 0 ? 0 : 1);
