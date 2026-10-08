/** A tool of the MCP server: what a model reads about it, what it takes, and the core it calls. */

import { z } from "zod";

import type { Session } from "./session.js";

/** A tool as declared, typed by its own schema. `manual` is the paragraph the server's instructions carry about it. */
interface Declared<Shape extends z.ZodRawShape> {
  name: string;
  /** One sentence: what the tool does, for the host's tool list. */
  description: string;
  schema: Shape;
  /** When to use it and what it answers, read by the model once, in the server's instructions. */
  manual: string;
  handler: (args: z.infer<z.ZodObject<Shape>>, session: Session) => Promise<unknown>;
}

/** A tool as the server lists it: its schema checks what a host sends before the handler sees it. */
export interface Tool {
  name: string;
  description: string;
  manual: string;
  schema: z.ZodRawShape;
  call(args: unknown, session: Session): Promise<unknown>;
}

/** Declare a tool; its handler receives arguments already checked against its schema. */
export function tool<Shape extends z.ZodRawShape>(declared: Declared<Shape>): Tool {
  const checked = z.object(declared.schema);
  return {
    name: declared.name,
    description: declared.description,
    manual: declared.manual,
    schema: declared.schema,
    call: (args, session) => declared.handler(checked.parse(args ?? {}), session),
  };
}

/** A refusal the model can act on: its words are the whole answer, with no stack. */
export class Refused extends Error {}
