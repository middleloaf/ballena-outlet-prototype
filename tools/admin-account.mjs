#!/usr/bin/env node
// Create, update or remove an admin account in D1.
//
//   npm run admin:account -- person@example.com            (prompts for the password)
//   npm run admin:account -- person@example.com --remove
//   add --local to target `wrangler dev`'s local database
//
// Only the PBKDF2 hash leaves this machine; the password is never written to
// disk or passed on a command line.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { hashPassword } from "../worker/auth.js";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const remove = args.includes("--remove");
const target = args.includes("--local") ? "--local" : "--remote";
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Uso: npm run admin:account -- correo@ejemplo.com [--remove] [--local]");
  process.exit(1);
}

async function ask(question) {
  if (!process.stdin.isTTY) {
    // Piped input (e.g. from a password manager): first line, newline optional.
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.split(/\r?\n/)[0];
  }
  // Interactive: read a line without echoing it.
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
let sql;
if (remove) {
  sql = `DELETE FROM admins WHERE email = ${sqlQuote(email)};`;
} else {
  const password = await ask(`Contraseña para ${email}: `);
  if (password.length < 12) {
    console.error("La contraseña debe tener al menos 12 caracteres.");
    process.exit(1);
  }
  if (process.stdin.isTTY && (await ask("Repetila: ")) !== password) {
    console.error("Las contraseñas no coinciden.");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  sql =
    `INSERT INTO admins (email, password_hash, created_at) VALUES (${sqlQuote(email)}, ${sqlQuote(hash)}, ${sqlQuote(new Date().toISOString())}) ` +
    `ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash;`;
}

const dir = mkdtempSync(join(tmpdir(), "admin-account-"));
try {
  const file = join(dir, "account.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  execFileSync("npx", ["wrangler", "d1", "execute", "ballena-inventory", target, "--file", file], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(remove ? `Cuenta eliminada: ${email}` : `Cuenta lista: ${email}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
