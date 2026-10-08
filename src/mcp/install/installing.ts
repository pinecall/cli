/** `pinecall mcp install`: Pinecall written into every assistant on this machine, listed, or taken out — and what was done, line by line. */

import { registered, written } from "./configs.js";
import { entryFor, hosts, installed, type Host } from "./hosts.js";

/** What happened to one assistant. */
export interface Done {
  host: Host;
  did: "added" | "replaced" | "removed" | "not installed" | "not there" | "failed";
  why?: string;
}

/** Write (or remove) Pinecall's entry in every installed assistant; an absent one is skipped, a broken file reported. */
export function installEverywhere(production: boolean, remove: boolean, home?: string): Done[] {
  return hosts(home).map((host): Done => {
    if (!installed(host)) return { host, did: "not installed" };
    const was = registered(host);
    if (remove && !was) return { host, did: "not there" };
    try {
      written(host, remove ? null : entryFor(host, production));
      return { host, did: remove ? "removed" : was ? "replaced" : "added" };
    } catch (failed) {
      return { host, did: "failed", why: failed instanceof Error ? failed.message : String(failed) };
    }
  });
}

/** Every assistant, whether it is installed, and whether Pinecall is in it; changes nothing. */
export function listed(home?: string): string[] {
  return hosts(home).map((host) => {
    const state = registered(host) ? "registered" : installed(host) ? "not registered" : "not installed";
    return `  ${host.label.padEnd(15)} ${state.padEnd(15)} ${host.file}`;
  });
}

/** The report: a line per assistant, and the two things that are not obvious. */
export function reported(done: Done[], remove: boolean): string[] {
  const lines = done.map((one) => `  ${one.did === "failed" ? "✗" : "·"} ${one.host.label.padEnd(15)} ${one.did.padEnd(14)} ${one.why ?? one.host.file}`);
  const touched = done.some((one) => one.did === "added" || one.did === "replaced");
  if (!touched || remove) return lines;
  return [
    ...lines,
    "",
    "  each file was copied beside itself as .bak first",
    "  restart the assistant: it read its config when it started",
    "  no key was written anywhere: the server reads the project's .env, and `login` signs this machine in",
  ];
}
