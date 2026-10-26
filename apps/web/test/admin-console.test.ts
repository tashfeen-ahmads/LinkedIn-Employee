import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The console works on a phone, and says when it could not look.
 *
 * Tables of six to ten columns scrolled sideways on a 375px screen with the
 * action column always off the edge, and seven pages read a failed query as
 * "No workspaces yet". These keep both from coming back on a page nobody
 * re-checks.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "app", "admin");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? pages(full) : name === "page.tsx" ? [full] : [];
  });
}

describe("the operator console", () => {
  const files = pages(root).map((file) => ({ file, src: readFileSync(file, "utf8") }));

  it("turns every table into cards on a phone", () => {
    for (const { file, src } of files) {
      const wrappers = src.match(/className="table-scroll[^"]*"/g) ?? [];
      for (const wrapper of wrappers) expect(wrapper, file).toContain("card-rows");
    }
  });

  it("labels every cell after the first, so a card says what each value is", () => {
    for (const { file, src } of files) {
      for (const body of src.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? []) {
        const rows = body.split(/<tr\b/).slice(1);
        for (const row of rows) {
          const cells = row.match(/<td\b[^>]*>/g) ?? [];
          for (const cell of cells.slice(1)) expect(cell, `${file}: ${cell}`).toMatch(/data-label=/);
        }
      }
    }
  });

  it("labels the cells of every phone-card table in the member app too", () => {
    // Analytics' table had its stage counts unlabelled and its two rates
    // labelled with each other's names, so on a phone the acceptance rate
    // read as the reply rate. This test only watched the console then.
    const appRoot = join(here, "..", "src", "app");
    const all = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? all(full) : name.endsWith(".tsx") ? [full] : [];
      });
    for (const file of all(appRoot)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("card-rows")) continue;
      for (const body of src.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? []) {
        for (const row of body.split(/<tr\b/).slice(1)) {
          const cells = row.match(/<td\b[^>]*>/g) ?? [];
          for (const cell of cells.slice(1)) expect(cell, `${file}: ${cell}`).toMatch(/data-label=/);
        }
      }
    }
  });

  it("never reads a failed list as an empty one", () => {
    for (const name of ["workspaces", "accounts", "users", "campaigns", "activity", "spend"]) {
      const src = readFileSync(join(root, name, "page.tsx"), "utf8");
      expect(src, name).toContain("<LoadFailed");
    }
  });
});
