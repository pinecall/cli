/** Console door for knowledge: push this directory's documents and score its golden. */

import { existsSync, statSync } from "node:fs";
import { type KnowledgePushed, type KnowledgeScore } from "@pinecall/agents/wire";

import { AN_EMPTY_GOLDEN, markdownUnder, NO_DIRECTORY, NO_GOLDEN, NO_MARKDOWN, pushedTo, scoredOn, theQuestionsIn } from "../docs.js";
import { homeOf, theAgentHere, type Home } from "../home.js";
import type { Door } from "../testing/gateway.js";
import { anObject, aString, maybeNumber, someWords } from "./asked.js";
import { Refusal } from "./refusal.js";

/** This directory's documents and knowledge golden. */
export interface Roster {
  agent: string | null;
  /** Knowledge base name (the class slug), or null without a class. */
  base: string | null;
  directory: string | null;
  files: number;
  golden: string | null;
  questions: number;
}

/** Knowledge door as the console server uses it. */
export interface Knowing {
  roster(): Promise<Roster>;
  push(asked: unknown): Promise<KnowledgePushed & { files: number }>;
  measure(asked: unknown): Promise<KnowledgeScore>;
}

/** Paths of this directory's documents and golden. */
export interface Here {
  agent: string | null;
  directory: string | null;
  golden: string | null;
}

const NOT_THIS_DIRECTORY = (asked: string, here: string | null): string =>
  here === null
    ? `no agent class in this directory: run \`pinecall start\` at ${asked}'s project`
    : `this process runs in ${here}'s directory: to push ${asked}'s knowledge, run \`pinecall start\` there`;

/**
 * Knowledge door for one `pinecall start`. Push and eval read local files, as `pinecall docs` does;
 * listing and dropping a base go straight to the gateway.
 */
export function knowingFrom(door: Door, agent: string | null, here: () => Promise<Here> = theDirectory): Knowing {
  return {
    async roster(): Promise<Roster> {
      const found = await here();
      const files = found.directory === null ? [] : documents(found.directory);
      const questions = found.golden === null || !existsSync(found.golden) ? null : theQuestionsIn(found.golden);
      return {
        agent: found.agent,
        base: found.agent,
        directory: found.directory,
        files: files.length,
        golden: found.golden !== null && existsSync(found.golden) ? found.golden : null,
        questions: questions?.length ?? 0,
      };
    },

    async push(asked: unknown): Promise<KnowledgePushed & { files: number }> {
      const given = anObject(asked, "a push");
      const found = await mine(aString(given, "agent"), here);
      const base = someWords(given, "base") ?? found.agent!;
      const directory = found.directory!;
      if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Refusal(404, NO_DIRECTORY(directory));
      const files = documents(directory);
      if (files.length === 0) throw new Refusal(422, NO_MARKDOWN(directory));
      return { ...(await pushedTo(door, base, files)), files: files.length };
    },

    async measure(asked: unknown): Promise<KnowledgeScore> {
      const given = anObject(asked, "a golden");
      const found = await mine(aString(given, "agent"), here);
      const base = someWords(given, "base") ?? found.agent!;
      const golden = found.golden!;
      if (!existsSync(golden)) throw new Refusal(404, NO_GOLDEN(golden));
      const questions = theQuestionsIn(golden);
      if (questions === null) throw new Refusal(422, AN_EMPTY_GOLDEN(golden));
      return await scoredOn(door, base, questions, maybeNumber(given, "k", 1, 100));
    },
  };
}

// The files are local, so only this directory's agent can be pushed or scored.
async function mine(asked: string, here: () => Promise<Here>): Promise<Here> {
  const found = await here();
  if (found.agent !== asked || found.directory === null) throw new Refusal(409, NOT_THIS_DIRECTORY(asked, found.agent));
  return found;
}

function documents(directory: string): ReturnType<typeof markdownUnder> {
  return existsSync(directory) && statSync(directory).isDirectory() ? markdownUnder(directory) : [];
}

/** This directory's agent and paths, or nulls when there is no agent. */
async function theDirectory(): Promise<Here> {
  try {
    const home = homeOf(theAgentHere());
    return { agent: home.name, directory: home.docs, golden: home.docsGolden };
  } catch {
    return { agent: null, directory: null, golden: null };
  }
}

/** Knowledge paths for one agent of a project. */
export function hereOf(home: Home, slug: string): () => Promise<Here> {
  return async () => ({ agent: slug, directory: home.docs, golden: home.docsGolden });
}
