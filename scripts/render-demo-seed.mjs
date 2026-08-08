#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { hashPassword, verifyPassword } from "better-auth/crypto";

function parseArgs(argv) {
  const result = { template: "scripts/demo-seed.template.sql", outFile: "artifacts/demo-seed.sql" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--template") result.template = argv[++index] ?? result.template;
    else if (argument === "--out-file") result.outFile = argv[++index] ?? result.outFile;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const password = process.env.DEMO_USER_PASSWORD ?? "";
if (password.length < 12) throw new Error("DEMO_USER_PASSWORD must contain at least 12 characters");

const hash = await hashPassword(password);
if (!(await verifyPassword({ hash, password }))) throw new Error("Generated demo password hash did not verify");

const escapedHash = hash.replaceAll("'", "''");
const template = await readFile(options.template, "utf8");
if (!template.includes("__DEMO_PASSWORD_HASH__")) throw new Error("Demo seed template has no password placeholder");
const rendered = template.replaceAll("__DEMO_PASSWORD_HASH__", escapedHash);
if (/__[A-Z0-9_]+__/.test(rendered)) throw new Error("Demo seed contains unresolved placeholders");

await writeFile(options.outFile, rendered, { mode: 0o600 });
await chmod(options.outFile, 0o600);
process.stdout.write(`${JSON.stringify({ outFile: options.outFile, accounts: 4 })}\n`);
