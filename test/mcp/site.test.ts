// The docs as the MCP server reads them: one file cut into pages, sections searched, a page found by address or path.

import { describe, expect, it } from "vitest";

import { pageAt, pagesOf, searched } from "../../src/mcp/site.js";

const FILE = `# Tools
Source: https://docs.pinecall.io/concepts/tools/

A method the model may call.

## Confirmation

A tool with confirm reads a sentence back to the caller after it ran.

## Timeouts

A tool that runs past its timeout answers an error.


# Drift
Source: https://docs.pinecall.io/guides/drift/

A judge's held-rate this week against the month before.
`;

describe("the docs, read", () => {
  it("are cut into pages by their titles and addresses", () => {
    const pages = pagesOf(FILE);

    expect(pages.map((page) => [page.title, page.url])).toEqual([
      ["Tools", "https://docs.pinecall.io/concepts/tools/"],
      ["Drift", "https://docs.pinecall.io/guides/drift/"],
    ]);
    expect(pages[0]!.body).toContain("## Timeouts");
  });

  it("answer a question with the section that holds its words, anchored to its heading", () => {
    const [best] = searched(pagesOf(FILE), "how does a tool confirm with the caller");

    expect(best).toMatchObject({ title: "Tools", section: "Confirmation", url: "https://docs.pinecall.io/concepts/tools/#confirmation" });
    expect(best!.snippet).toContain("reads a sentence back");
  });

  it("answer nothing for a question of only small words, and nothing that is not there", () => {
    expect(searched(pagesOf(FILE), "how do the")).toEqual([]);
    expect(searched(pagesOf(FILE), "kubernetes")).toEqual([]);
  });

  it("find a page by its address, its path, or its path with an anchor", () => {
    const pages = pagesOf(FILE);

    expect(pageAt(pages, "https://docs.pinecall.io/guides/drift/")?.title).toBe("Drift");
    expect(pageAt(pages, "concepts/tools")?.title).toBe("Tools");
    expect(pageAt(pages, "/concepts/tools/#timeouts")?.title).toBe("Tools");
    expect(pageAt(pages, "nowhere")).toBeUndefined();
  });
});
