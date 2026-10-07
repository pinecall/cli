/** The suite: the CLI, in node; the fixtures are tenant classes, written as a tenant writes them. */

import { defineConfig } from "vitest/config";

// The fixtures use the framework's legacy decorators and its text JSX runtime, as a tenant does.
export default defineConfig({
  oxc: {
    decorator: { legacy: true },
    jsx: { runtime: "automatic", importSource: "@pinecall/agents/views" },
  },
  test: {
    name: "pinecall-cli",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
