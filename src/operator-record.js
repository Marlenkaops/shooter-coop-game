import { ACHIEVEMENTS } from "../shared/career.js";
import { RANK_DIFFICULTIES } from "../shared/rankings.js";
import { WEAPONS } from "../shared/weapons.js";
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const button = (action, tag, label) => `<button type="button" class="secondary" data-social-action="${action}" data-tag="${tag}">${label}</button>`;
export function operatorMarkup(profile) {
  const c = profile.stats, number = (value) => value === null || value === undefined ? "Unrecorded" : value.toLocaleString();
  const cards = [["Saved XP rank", profile.rank ? `#${profile.rank}` : "Unranked"], ["Player level", profile.level], ["Prestige", profile.prestige],
    ["Favorite weapon", profile.favoriteWeaponId ? WEAPONS[profile.favoriteWeaponId].name : "Unrecorded"]];
  const stats = c ? [["Verified eliminations", c.kills], ["Assists", c.assists], ["Revives", c.revives], ["Objective score", c.objectiveScore],
    ["Accuracy", c.shots ? `${(c.hits * 100 / c.shots).toFixed(1)}% (${c.hits}/${c.shots})` : "Unrecorded"],
    ["Damage", c.damage], ["Full-mission victories", c.wins], ["Highest clear", RANK_DIFFICULTIES[c.highestDifficulty]]] : [];
  return `<div class="record-identity"><span class="eyebrow">#${escape(profile.playerTag)}</span><h3>${escape(profile.username)}</h3>
    <p>${profile.squad ? `Squad: ${escape(profile.squad.name)}` : "Independent operator"}</p></div>
    <div class="record-grid">${cards.map(([label, value]) => `<article><span>${label}</span><strong>${escape(value)}</strong></article>`).join("")}</div>
    <p>Saved totals: ${number(profile.xp)} XP / ${number(profile.lifetimeKills)} eliminations /
      ${number(profile.lifetimeAssists)} assists / ${number(profile.lifetimeRevives)} revives / ${number(profile.lifetimeObjectiveScore)} objective.
      Older totals have no invented dates, accuracy, damage or mission times. Favorite weapon uses confirmed mastery eliminations.</p>
    <h3>Verified PvE service record</h3><p>${c ? `Tracking since ${new Date(profile.trackedSince).toISOString().slice(0, 10)} UTC.`
      : "No eligible tracked matches yet. Historical detailed statistics are unavailable, not zero."}</p>
    <div class="record-grid">${stats.map(([label, value]) => `<article><span>${label}</span><strong>${escape(value)}</strong></article>`).join("")}</div>
    ${c ? `<h3>Fastest unmodified clears</h3>${Object.entries(c.bestTimes).sort(([, a], [, b]) => a[0] - b[0]).map(([route, value]) =>
    `<p>${escape(route)}: ${(value[0] / 1000).toFixed(2)}s / ${RANK_DIFFICULTIES[value[1]]}</p>`).join("") || "<p>Not recorded yet.</p>"}` : ""}
    <h3>Achievement showcase</h3><div class="record-grid">${profile.showcase.map((id) =>
    `<article class="record-badge"><strong>${ACHIEVEMENTS[id].name}</strong><p>${ACHIEVEMENTS[id].description}</p></article>`).join("") || "<p>No showcased badges yet.</p>"}</div>
    <h3>Earned badges</h3><p>${profile.badges.map((id) => ACHIEVEMENTS[id].name).join(" / ") || "No badges earned yet."}</p>
    ${profile.self ? `<form id="showcaseForm"><fieldset><legend>Choose up to three earned badges</legend>${profile.badges.map((id) =>
      `<label class="record-choice"><input type="checkbox" name="badge" value="${id}" ${profile.showcase.includes(id) ? "checked" : ""}>${ACHIEVEMENTS[id].name}</label>`).join("")}
      <button class="secondary" type="submit">Save showcase</button></fieldset></form>` : ""}`;
}
export function socialMarkup(state) {
  const person = (p) => `<button type="button" class="secondary record-view" data-view-tag="${p.playerTag}">${escape(p.username)} #${p.playerTag}</button>`;
  const list = (people, controls) => people.map((p) => `<article>${person(p)}<div class="record-actions">${controls(p)}</div></article>`).join("") || "<p>None.</p>";
  return `<p>Your public tag: <strong>#${state.playerTag}</strong>. Friends require acceptance on both accounts. Only you can view this list.
    Squad names and rankings are public; membership changes are locked during deployment.</p>
    <form id="friendForm" class="record-form"><label>Operator public tag<input id="friendTag" maxlength="9" required autocomplete="off" spellcheck="false"></label>
      <button class="secondary">Send friend request</button></form>
    <h3>Incoming requests</h3><div class="record-grid">${list(state.incoming, (p) =>
      button("friendAccept", p.playerTag, "Accept") + button("friendDecline", p.playerTag, "Decline"))}</div>
    <h3>Sent requests</h3><div class="record-grid">${list(state.outgoing, (p) => button("friendCancel", p.playerTag, "Cancel request"))}</div>
    <h3>Friends (${state.friends.length}/100)</h3><div class="record-grid">${list(state.friends, (p) =>
      button("friendRemove", p.playerTag, "Remove friend") + (state.squad?.leader ? button("squadInvite", p.playerTag, "Invite to squad") : ""))}</div>
    <h3>Persistent squad</h3>${state.squad ? `<h4>${escape(state.squad.name)} #${state.squad.tag}</h4>
      <div class="record-grid">${list(state.squad.members, (p) => state.squad.leader && p.playerTag !== state.playerTag
      ? button("squadRemove", p.playerTag, "Remove from squad") : "")}</div>
      ${button("squadLeave", "", state.squad.leader ? "Disband squad (record retained)" : "Leave squad")}
      <p>Invited: ${state.squad.invites.map((p) => escape(p.username)).join(", ") || "None"}</p>` :
    `<form id="squadForm" class="record-form"><label>Squad name (3-24 characters)<input id="squadName" maxlength="24" required autocomplete="off"></label>
      <button class="secondary">Create / reactivate squad</button></form>`}
    <p>Deploy with at least two registered members in the same room to earn squad scores. Solo or mixed-squad rooms do not qualify.
      The whole starting roster must contribute and remain through settlement; matches count once, not once per member.</p>
    <h3>Squad invitations</h3><div class="record-grid">${state.invitations.map((s) => `<article><h4>${escape(s.name)}</h4><p>${s.members}/4 operators</p>
      ${button("squadAccept", s.tag, "Join squad")}${button("squadDecline", s.tag, "Decline invitation")}</article>`).join("") || "<p>None.</p>"}</div>`;
}
export function mountOperatorRecord(socket) {
  const panel = document.createElement("dialog");
  panel.id = "operatorPanel"; panel.className = "leaderboard-panel operator-panel";
  panel.setAttribute("aria-labelledby", "operatorTitle");
  panel.innerHTML = `<header class="leaderboard-heading"><div><span class="eyebrow">Operators & squads</span><h2 id="operatorTitle">Service record</h2></div>
    <button id="operatorClose" class="secondary" autofocus>Close</button></header>
    <nav class="record-actions" aria-label="Operator sections"><button class="secondary" data-record-tab="profile">My profile</button>
      <button class="secondary" data-record-tab="social">Friends & squad</button><button class="secondary" id="operatorRefresh">Refresh</button></nav>
    <form id="profileLookup" class="record-form"><label>Public operator tag<input id="profileTag" maxlength="9" required autocomplete="off" spellcheck="false"></label><button class="secondary">View profile</button></form>
    <p id="operatorError" class="error" role="status" aria-live="polite"></p><div id="operatorContent"></div>`;
  document.querySelector("#game").append(panel);
  let tab = "profile", tag, pending = false, generation = 0;
  const content = panel.querySelector("#operatorContent"), error = panel.querySelector("#operatorError");
  function busy(value) {
    pending = value; panel.setAttribute("aria-busy", String(value));
    for (const control of panel.querySelectorAll("input,button")) if (control.id !== "operatorClose") control.disabled = value;
    for (const node of panel.querySelectorAll("[data-record-tab]")) node.setAttribute("aria-pressed", String(node.dataset.recordTab === tab));
  }
  function request(event, input, callback) {
    if (pending) return;
    if (!socket.connected) { error.textContent = "Connection lost. Reconnect before using records."; return; }
    const version = generation;
    error.textContent = ""; busy(true);
    const done = (failure, result) => {
      if (version !== generation || !panel.open) return;
      busy(false);
      if (failure || !result?.ok) error.textContent = failure ? "Request timed out. Refresh to check the saved result." : result?.error || "Records unavailable.";
      else { callback(result); busy(false); }
    };
    if (input === undefined) socket.timeout(6000).emit(event, done);
    else socket.timeout(6000).emit(event, input, done);
  }
  function load() {
    request(tab === "social" ? "socialStatus" : "publicProfile", tab === "social" ? undefined : { ...(tag ? { tag } : {}) },
      (result) => { content.innerHTML = tab === "social" ? socialMarkup(result) : operatorMarkup(result.profile); });
  }
  function open(nextTag) {
    tag = nextTag; tab = "profile";
    if (!panel.open) panel.showModal();
    load();
  }
  for (const node of document.querySelectorAll(".records-open")) node.onclick = () => open();
  panel.querySelector("#operatorClose").onclick = () => panel.close();
  panel.querySelector("#operatorRefresh").onclick = load;
  panel.querySelector("#profileLookup").onsubmit = (event) => {
    event.preventDefault(); tag = panel.querySelector("#profileTag").value.trim().replace(/^#/, "").toUpperCase(); tab = "profile"; load();
  };
  panel.addEventListener("click", (event) => {
    const node = event.target.closest("button"); if (!node) return;
    if (node.dataset.recordTab) { tab = node.dataset.recordTab; tag = undefined; load(); }
    if (node.dataset.viewTag) { tab = "profile"; tag = node.dataset.viewTag; load(); }
    if (node.dataset.socialAction) request("socialAction", { action: node.dataset.socialAction,
      ...(node.dataset.tag ? { tag: node.dataset.tag } : {}) }, (result) => { content.innerHTML = socialMarkup(result); });
  });
  panel.addEventListener("submit", (event) => {
    if (!["friendForm", "squadForm", "showcaseForm"].includes(event.target.id)) return;
    event.preventDefault();
    if (event.target.id === "showcaseForm") request("profileShowcase", { badges: [...content.querySelectorAll("[name='badge']:checked")].map((node) => node.value) },
      (result) => { content.innerHTML = operatorMarkup(result.profile); });
    else request("socialAction", event.target.id === "friendForm"
      ? { action: "friendRequest", tag: content.querySelector("#friendTag").value.trim().replace(/^#/, "").toUpperCase() }
      : { action: "squadCreate", name: content.querySelector("#squadName").value.trim() },
    (result) => { content.innerHTML = socialMarkup(result); });
  });
  panel.addEventListener("close", () => { generation++; pending = false; });
  socket.on("socialChanged", () => { if (panel.open && tab === "social" && !pending) load(); });
  socket.on("disconnect", () => { if (panel.open) { generation++; busy(false); error.textContent = "Connection lost. Refresh after reconnecting."; } });
  for (const event of ["joined", "matchStarted", "banned"]) socket.on(event, () => panel.close());
  return { open };
}
