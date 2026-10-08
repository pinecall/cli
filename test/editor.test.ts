// The person's editor: refused in their words when none is set, and the text they saved handed back.

import { afterEach, describe, expect, it } from "vitest";

import { inTheEditor, NO_EDITOR } from "../src/editor.js";

const was = { visual: process.env["VISUAL"], editor: process.env["EDITOR"] };

afterEach(() => {
  for (const [name, value] of [["VISUAL", was.visual], ["EDITOR", was.editor]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the editor", () => {
  it("is refused by name when neither $VISUAL nor $EDITOR is set", async () => {
    delete process.env["VISUAL"];
    delete process.env["EDITOR"];

    await expect(inTheEditor("x")).rejects.toThrow(NO_EDITOR);
  });

  it("hands back what the editor left in the file", async () => {
    delete process.env["VISUAL"];
    process.env["EDITOR"] = "sh -c 'printf \"# Hours\\nNine to five.\\n\" > \"$0\"'";

    expect(await inTheEditor("old")).toBe("# Hours\nNine to five.\n");
  });

  it("writes nothing when the editor fails, and says which one", async () => {
    delete process.env["VISUAL"];
    process.env["EDITOR"] = "false";

    await expect(inTheEditor("old")).rejects.toThrow("false exited with 1: nothing written");
  });
});
