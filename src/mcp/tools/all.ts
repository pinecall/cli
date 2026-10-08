/** Every tool the MCP server offers, in the order a person meets them. */

import type { Tool } from "../tool.js";
import { link } from "./link.js";
import { login } from "./login.js";
import { project } from "./project.js";
import { whoami } from "./whoami.js";

export const TOOLS: readonly Tool[] = [whoami, login, link, project];
