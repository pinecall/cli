// A project with no framework installed runs on the server's, lent to the agent's thread alone: nothing is written into the project.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { installsItsOwn, lentSaid, lentTo } from "../../../src/mcp/holding/framework.js";
import { Logs, threadOnce, threadServing } from "../../../src/mcp/holding/thread.js";

// A framework as npm leaves one: a manifest that names it, its tenant tsconfig, a root export and a serve entry
// that imports the class it is given — which imports the framework by name, as every tenant's does.
function aFramework(version: string): string {
  const folder = mkdtempSync(join(tmpdir(), "pinecall-framework-"));
  mkdirSync(join(folder, "serve"));
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "@pinecall/agents", version, type: "module", exports: { ".": "./index.js", "./serve": "./serve/index.js" } }));
  writeFileSync(join(folder, "tsconfig.tenant.json"), "{}\n");
  writeFileSync(join(folder, "index.js"), `export const LENT = "the framework ${version}";\n`);
  writeFileSync(
    join(folder, "serve", "index.js"),
    `export async function main(argv, io) {
  const { said } = await import(argv[argv.indexOf("--file") + 1]);
  if (argv[0] === "prompt") { io.out.write(said + "\\n"); return 0; }
  io.out.write(JSON.stringify({ type: "agent.registered", agent: "desk", call: null, data: { app: said } }) + "\\n");
  await new Promise((left) => { io.input.on("end", left); io.input.resume(); });
  return 0;
}
`,
  );
  return folder;
}

// A project that installed nothing: its class imports the framework by name.
function aProject(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "pinecall-project-"));
  mkdirSync(join(root, "agents", "desk"), { recursive: true });
  const file = join(root, "agents", "desk", "agent.mjs");
  writeFileSync(file, `import { LENT } from "@pinecall/agents";\nexport const said = LENT;\n`);
  return { root, file };
}

describe("a project that installed no framework", () => {
  it("is lent the server's: its serve entry, its tsconfig, and where to resolve it from", () => {
    const ours = aFramework("0.9.21");
    const { root } = aProject();

    const lent = lentTo(root, ours);

    expect(installsItsOwn(root)).toBe(false);
    expect(lent).toMatchObject({ version: "0.9.21", entry: join(realpathSync(ours), "serve", "index.js") });
    expect(JSON.parse(readFileSync(lent!.tsconfig, "utf8"))).toEqual({ extends: join(ours, "tsconfig.tenant.json"), include: [join(root, "**", "*")] });
    expect(lent!.tsconfig.startsWith(root)).toBe(false);
    expect(lentSaid(lent!)).toBe("@pinecall/agents 0.9.21 lent by this server: npm install in the project pins its own");
  });

  it("runs in a thread whose class imports the framework by name, and nothing is written into the project", async () => {
    const ours = aFramework("0.9.21");
    const { root, file } = aProject();
    const lent = lentTo(root, ours)!;

    const thread = threadServing({ command: [process.execPath, lent.entry, "start", "--file", file], env: {} }, new Logs(), undefined, lent);

    expect(await thread.registered("desk")).toBe("the framework 0.9.21");
    expect(thread.lent).toBe(lent);
    expect(await thread.stop()).toBe(0);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
  });

  it("prints its prompt the same way, a one-shot thread on the lent framework", async () => {
    const ours = aFramework("0.9.21");
    const { root, file } = aProject();
    const lent = lentTo(root, ours)!;

    expect(await threadOnce({ command: [process.execPath, lent.entry, "prompt", "--file", file], env: {} }, lent)).toMatchObject({ code: 0, out: "the framework 0.9.21\n" });
  });
});

describe("a project that installed its own", () => {
  it("is lent nothing: it runs on the version it pinned", () => {
    const { root } = aProject();
    const installed = join(root, "node_modules", "@pinecall", "agents");
    mkdirSync(join(installed, "serve"), { recursive: true });
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "@pinecall/agents", version: "0.9.30", exports: { "./serve": "./serve/index.js" } }));
    writeFileSync(join(installed, "serve", "index.js"), "");

    expect(installsItsOwn(root)).toBe(true);
    expect(lentTo(root, aFramework("0.9.21"))).toBeUndefined();
  });
});
