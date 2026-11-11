import { describeBanLength } from "../shared/bans.js";

export async function submitBanAppeal(reason) {
  const response = await fetch("/api/ban-appeals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: localStorage.getItem("lastLightToken"), reason }),
    signal: AbortSignal.timeout(15_000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Your appeal could not be sent. Try again.");
  return result;
}

export function banTitle(ban) {
  const length = describeBanLength(ban?.until ? ban.until - ban.at : null);
  return `${ban?.kind === "ip" ? "IP Banned" : "Banned"} ${length}`;
}

export function banRemaining(until, now = Date.now()) {
  const left = Math.max(0, until - now);
  const days = Math.floor(left / 86_400_000), hours = Math.floor(left / 3_600_000) % 24;
  const minutes = Math.floor(left / 60_000) % 60, seconds = Math.floor(left / 1000) % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// Full-page notice for a banned player. Uses textContent only: the reason is moderator text.
export function showBanScreen(ban, {
  root = document.body, now = Date.now, reload = () => location.reload(), submitAppeal = submitBanAppeal
} = {}) {
  root.querySelector("#banScreen")?.remove();
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const screen = make("div", "ban-screen");
  screen.id = "banScreen";
  screen.setAttribute("role", "alertdialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", "banTitle");
  const card = make("section", "ban-card");
  const title = make("h1", "", banTitle(ban));
  title.id = "banTitle";
  const temporary = Boolean(ban?.until);
  card.append(title, make("p", "", ban?.kind === "ip"
    ? "An administrator has blocked your network address from Deadlight Ops. Every account on this connection is blocked."
    : "An administrator has determined that your behavior in Deadlight Ops broke the rules, so your account has been suspended."));
  if (ban?.at) {
    const reviewed = make("p", "ban-meta", "Reviewed: ");
    reviewed.append(make("strong", "", new Date(ban.at).toLocaleString()));
    card.append(reviewed);
  }
  const note = make("p", "ban-note", "Moderator Note: ");
  note.append(make("strong", "", ban?.reason || "No reason was given."));
  card.append(note);
  let timer = null;
  const button = make("button", "ban-retry", "Try again");
  button.type = "button";
  button.onclick = () => reload();
  if (temporary) {
    const ends = make("p", "ban-meta", "Ends: ");
    ends.append(make("strong", "", new Date(ban.until).toLocaleString()));
    const countdown = make("p", "ban-countdown");
    countdown.setAttribute("aria-live", "polite");
    const tick = () => {
      const over = ban.until <= now();
      countdown.textContent = over ? "Your ban has ended. You can play again." : `Time left: ${banRemaining(ban.until, now())}`;
      button.disabled = !over;
      if (over && timer) { clearInterval(timer); timer = null; }
    };
    tick();
    if (ban.until > now()) timer = setInterval(tick, 1000);
    card.append(ends, countdown, make("p", "", "Please follow the rules so Deadlight Ops stays fun for everyone."), button);
  } else {
    card.append(make("p", "", "This ban does not end on its own. Contact the game administrator if you think it is a mistake."));
  }
  const contact = make("button", "secondary ban-contact", "Contact / Appeal ban");
  contact.type = "button";
  contact.setAttribute("aria-expanded", "false");
  contact.setAttribute("aria-controls", "banAppealForm");
  const form = make("form", "ban-appeal-form hidden");
  form.id = "banAppealForm";
  const label = make("label", "", "Why should you be unbanned?");
  label.htmlFor = "banAppealReason";
  const reason = make("textarea");
  reason.id = "banAppealReason";
  reason.minLength = 10;
  reason.maxLength = 1000;
  reason.required = true;
  reason.rows = 4;
  reason.placeholder = "Explain what happened and why the ban should be removed.";
  reason.setAttribute("aria-describedby", "banAppealHint banAppealStatus");
  const hint = make("small", "", "10-1000 characters. Your message goes privately to the game admins. Do not include passwords or personal information. One appeal per ban.");
  hint.id = "banAppealHint";
  const send = make("button", "ban-appeal-send", "Send appeal");
  send.type = "submit";
  const status = make("p", "ban-appeal-status");
  status.id = "banAppealStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const check = make("button", "secondary hidden", "Check ban status");
  check.type = "button";
  check.onclick = () => reload();
  let submitting = false;
  contact.onclick = () => {
    const open = form.classList.contains("hidden");
    form.classList.toggle("hidden", !open);
    contact.setAttribute("aria-expanded", String(open));
    if (open) reason.focus();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const explanation = reason.value.trim();
    if (explanation.length < 10 || explanation.length > 1000) {
      status.textContent = "Explain your appeal in 10-1000 characters.";
      reason.focus();
      return;
    }
    submitting = true;
    send.disabled = true;
    status.textContent = "Sending appeal...";
    try {
      const result = await submitAppeal(explanation);
      status.textContent = result.status === "rejected"
        ? "An admin has reviewed and declined this appeal. The ban remains in place."
        : result.status === "approved" ? "Your appeal was approved. Check your ban status to return to the game."
          : "Appeal sent. An admin will review it. Sending an appeal does not automatically remove a ban.";
      reason.disabled = true;
      send.textContent = result.alreadySubmitted ? "Appeal already received" : "Appeal sent";
      check.classList.remove("hidden");
    } catch (error) {
      status.textContent = error.name === "TimeoutError" || error.name === "TypeError"
        ? "Cannot send your appeal right now. Check your connection and try again."
        : error.message || "Your appeal could not be sent. Try again.";
      submitting = false;
      send.disabled = false;
    }
  };
  form.append(label, reason, hint, send, status, check);
  card.append(contact, form);
  const privacy = make("a", "ban-link", "Privacy policy");
  privacy.href = "/privacy.html";
  privacy.target = "_blank";
  privacy.rel = "noopener";
  card.append(privacy);
  title.tabIndex = -1;
  screen.append(card);
  root.append(screen);
  (temporary && !button.disabled ? button : title).focus?.();
  return { element: screen, stop() { if (timer) clearInterval(timer); timer = null; } };
}
