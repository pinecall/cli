// Vitest reads no tsconfig: the framework's two compiler facts, legacy decorators and its JSX runtime, again.
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    decorator: { legacy: true },
    jsx: { runtime: "automatic", importSource: "@pinecall/agents/views" },
  },
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
