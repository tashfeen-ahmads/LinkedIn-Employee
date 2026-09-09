import { describe, expect, it } from "vitest";
import { renderKnowledge, selectKnowledge } from "../src/knowledge.js";

const doc = (title: string, size: number) => ({ title, content: "x".repeat(size) });

describe("selectKnowledge", () => {
  it("includes everything that fits", () => {
    const docs = [doc("Pricing", 100), doc("Security", 100)];
    expect(selectKnowledge(docs, 1000).included).toHaveLength(2);
    expect(selectKnowledge(docs, 1000).omitted).toEqual([]);
  });

  it("drops a whole document rather than truncating one", () => {
    // Half a pricing page is answered from confidently and is wrong.
    const docs = [doc("Pricing", 100), doc("Handbook", 5000)];
    const result = selectKnowledge(docs, 500);
    expect(result.included.map((d) => d.title)).toEqual(["Pricing"]);
    expect(result.included[0]!.content).toHaveLength(100);
    expect(result.omitted).toEqual(["Handbook"]);
  });

  it("never truncates the content of an included document", () => {
    const docs = [doc("Pricing", 400)];
    const result = selectKnowledge(docs, 500);
    expect(result.included[0]!.content).toBe(docs[0]!.content);
  });

  it("does not let one oversized document starve the shorter ones after it", () => {
    const docs = [doc("Handbook", 5000), doc("Pricing", 100), doc("Security", 100)];
    const result = selectKnowledge(docs, 500);
    expect(result.included.map((d) => d.title)).toEqual(["Pricing", "Security"]);
    expect(result.omitted).toEqual(["Handbook"]);
  });

  it("omits a document larger than the whole budget rather than trimming it to fit", () => {
    const result = selectKnowledge([doc("Handbook", 5000)], 500);
    expect(result.included).toEqual([]);
    expect(result.omitted).toEqual(["Handbook"]);
  });

  it("counts the title as well as the content", () => {
    const result = selectKnowledge([doc("Pricing", 98)], 100);
    expect(result.included).toHaveLength(0);
  });
});

describe("renderKnowledge", () => {
  it("tells the agent it may not state product facts when there is nothing", () => {
    expect(renderKnowledge([])).toContain("empty");
  });

  it("names what it left out, so the agent hands off instead of guessing", () => {
    const rendered = renderKnowledge([doc("Pricing", 10), doc("Handbook", 100_000)]);
    expect(rendered).toContain("Pricing");
    expect(rendered).toContain("Handbook");
    expect(rendered).toContain("you have not read");
  });

  it("says nothing about omissions when there are none", () => {
    expect(renderKnowledge([doc("Pricing", 10)])).not.toContain("you have not read");
  });
});
