import { STAFF_ROLES } from "../shared/staff.js";
import { parseBanDuration } from "../shared/bans.js";

export const ADMIN_COMMAND_HELP = [
  "?help - show every command",
  "?fly <player> [on|off] - toggle collision-checked flight for an active player",
  "?ban <player> [length] [reason] - ban an account; length like 30m, 2h, 1d, 7d or perm (default); only owners can ban staff",
  "?ipban <player> [length] [reason] - ban an online player's address as well; same lengths",
  "?announcement <message> - display a server-wide message",
  `?role <player> <${Object.keys(STAFF_ROLES).join("|")}|none> - owner only; assign a staff tag`,
  "?codes <player> - owner only; replace their codes with three one-use six-digit codes",
  'Use a full Operator ID, #eight-character tag, or exact username. Put names containing spaces in double quotes.'
];

export function executeAdminCommand(line, operations) {
  if (typeof line !== "string" || line.length > 500 || /[\u0000-\u001f\u007f]/.test(line)) {
    return { ok: false, error: "Commands must be one line, up to 500 characters." };
  }
  const match = /^\?([a-z]+)(?:\s+([\s\S]*))?$/i.exec(line.trim());
  if (!match) return { ok: false, error: "Start a command with ?. Use ?help for the full list." };
  const command = match[1].toLowerCase(), rest = (match[2] || "").trim();
  if (command === "help") return rest ? { ok: false, error: "Usage: ?help" } : { ok: true, lines: ADMIN_COMMAND_HELP };
  if (command === "announcement") {
    if (!rest || rest.length > 240) return { ok: false, error: "Usage: ?announcement <message of 1-240 characters>" };
    return operations.announce(rest);
  }
  if (!["fly", "ban", "ipban", "role", "codes"].includes(command)) return { ok: false, error: "Unknown command. Use ?help." };
  if (["role", "codes"].includes(command) && !operations.owner) return { ok: false, error: "Only the verified owner can assign roles or issue verification codes." };
  const target = /^(?:"([^"]+)"|([^\s"]+))(?:\s+([\s\S]*))?$/.exec(rest);
  if (!target) return { ok: false, error: `Usage: ?${command} <player>${command === "role" ? " <role>" : ""}. Use ?help.` };
  const resolved = operations.resolve(target[1] || target[2]);
  if (!resolved.ok) return resolved;
  const argument = (target[3] || "").trim();
  if (command === "fly") {
    if (argument && !["on", "off"].includes(argument)) return { ok: false, error: "Usage: ?fly <player> [on|off]" };
    return operations.fly(resolved.profile, argument || "toggle");
  }
  if (command === "ban" || command === "ipban") {
    const [first = "", ...words] = argument.split(/\s+/);
    const length = parseBanDuration(first);
    const reason = (length === undefined ? argument : words.join(" ")).trim() || "Banned by an administrator.";
    if (reason.length > 300) return { ok: false, error: "Keep the ban reason under 300 characters." };
    return operations.ban(resolved.profile, reason, {
      kind: command === "ipban" ? "ip" : "player", duration: length === undefined || length === null ? "perm" : first.toLowerCase()
    });
  }
  if (command === "role") {
    if (argument !== "none" && !Object.hasOwn(STAFF_ROLES, argument)) return { ok: false, error: "Unknown staff role. Use ?help." };
    return operations.role(resolved.profile, argument);
  }
  if (argument) return { ok: false, error: "Usage: ?codes <player>" };
  return operations.codes(resolved.profile);
}
