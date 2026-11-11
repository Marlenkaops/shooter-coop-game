import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { dataDir } from "../server/data.js";
import { hashAdminPassword, validateAdminCredentials } from "../server/admin-login.js";

let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  }
});
const terminal = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
try {
  if (process.argv.slice(2).some((argument) => argument !== "--replace")) {
    throw new Error("Only --replace is supported for replacing an existing account.");
  }
  const username = process.env.ADMIN_SETUP_USER ?? (await terminal.question("Admin username: ")).trim();
  let password = process.env.ADMIN_SETUP_PASSWORD;
  if (password === undefined) {
    process.stdout.write("Admin password (hidden): ");
    muted = true;
    password = await terminal.question("");
    muted = false;
    process.stdout.write("\n");
  }
  const credentials = validateAdminCredentials({ username, passwordHash: await hashAdminPassword(password) });
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, "admin-login.json");
  if (process.argv.includes("--replace")) {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Existing credentials must be a regular private file.");
    validateAdminCredentials(JSON.parse(fs.readFileSync(filename, "utf8")));
    const temporary = `${filename}.next`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, filename);
    } catch (error) {
      if (error.code !== "EEXIST" && fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
  } else {
    fs.writeFileSync(filename, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
  }
  console.log("Admin sign-in configured privately. Restart the server to enable it.");
} catch (error) {
  console.error(error.code === "EEXIST"
    ? "Admin credentials already exist. Keep or remove the private admin-login.json before configuring another account."
    : `Admin setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
