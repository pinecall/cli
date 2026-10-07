/** A project as a release: its files, never its secrets or its dependencies, as a gzipped tarball. */

import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

// The box installs the dependencies itself; .env holds the keys, which travel as secrets instead.
const NEVER = new Set(["node_modules", ".git", "dist", ".pinecall", ".DS_Store"]);

const A_DOTENV = /^\.env(\..*)?$/;

const BLOCK = 512;

/** Whether a path of the project stays out of every release. */
export function isLeftOut(path: string): boolean {
  return path.split(/[\\/]/).some((part) => NEVER.has(part) || A_DOTENV.test(part));
}

/**
 * The project's files, relative and sorted: what git would commit when the folder is a checkout,
 * every file otherwise, and in both cases nothing `isLeftOut` names. A tracked file deleted on
 * disk is not a file.
 */
export function projectFiles(root: string): string[] {
  const listed = gitFiles(root) ?? walked(root, root);
  return listed.filter((path) => !isLeftOut(path) && isAFile(join(root, path))).sort();
}

/** The files as one gzipped ustar archive: plain files, their paths and modes as the project has them. */
export function packed(root: string, files: readonly string[]): Buffer {
  const blocks: Buffer[] = [];
  for (const path of files) {
    const content = readFileSync(join(root, path));
    const executable = (lstatSync(join(root, path)).mode & 0o111) !== 0;
    blocks.push(header(path, content.length, executable), content, Buffer.alloc((BLOCK - (content.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(blocks));
}

function isAFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function gitFiles(root: string): string[] | undefined {
  try {
    const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return listed.toString("utf8").split("\0").filter((path) => path !== "");
  } catch {
    return undefined;
  }
}

function walked(root: string, folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (NEVER.has(entry.name)) continue;
    if (entry.isDirectory()) found.push(...walked(root, path));
    else if (entry.isFile()) found.push(relative(root, path).split(sep).join("/"));
  }
  return found;
}

// ustar: a name over 100 bytes is split at a slash into prefix (155) and name (100).
function header(path: string, size: number, executable: boolean): Buffer {
  const block = Buffer.alloc(BLOCK);
  const [prefix, name] = splitName(path);
  block.write(name, 0, 100, "utf8");
  block.write(executable ? "0000755\0" : "0000644\0", 100, 8, "ascii");
  block.write("0000000\0", 108, 8, "ascii");
  block.write("0000000\0", 116, 8, "ascii");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  block.write("00000000000\0", 136, 12, "ascii");
  block.write("        ", 148, 8, "ascii");
  block.write("0", 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  block.write(prefix, 345, 155, "utf8");
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

function splitName(path: string): [string, string] {
  if (Buffer.byteLength(path) <= 100) return ["", path];
  const cut = path.lastIndexOf("/", 155);
  if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) throw new Error(`${path}: too long a path for a release`);
  return [path.slice(0, cut), path.slice(cut + 1)];
}
