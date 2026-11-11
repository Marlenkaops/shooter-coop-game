import { ACHIEVEMENTS, ATTACHMENTS, careerFor, CHALLENGES, classLevelXp, masteryLevel,
  periodFor, PERKS, perkUnlocked, prestigeRequired, seasonAt, SEASON_TIER_XP, SEASON_TIERS,
  weaponLevelXp, WEAPON_FINISHES } from "../shared/career.js";
import { SQUAD_CLASSES } from "../shared/teamwork.js";
import { WEAPONS } from "../shared/weapons.js";

const meter = (value, target, label) => `<progress max="${target}" value="${Math.min(value, target)}" aria-label="${label}"></progress>
  <small>${value.toLocaleString()} / ${target.toLocaleString()}</small>`;
const claimButton = (type, key, period, unlocked, claimed) =>
  `<button class="secondary" data-career-claim="${type}" data-key="${key}" data-period="${period}" ${!unlocked || claimed ? "disabled" : ""}>${claimed ? "Claimed" : unlocked ? "Claim reward" : "Locked"}</button>`;

export function careerMarkup(profile, { tab = "loadout", weaponId = profile.equippedWeaponId, now = Date.now() } = {}) {
  const c = careerFor(profile), season = seasonAt(now);
  if (tab === "contracts") return `<p>Only server-validated PvE match results count. Rewards are claimed once.
    Daily reset: 00:00 UTC; weekly reset: Monday 00:00 UTC. No training or Free-for-All credit.</p>
    <div class="career-grid">${Object.entries(CHALLENGES).map(([id, challenge]) => {
    const period = periodFor(challenge.cadence, now), progress = c.periods[period];
    const value = progress?.[challenge.metric] || 0;
    return `<article><span class="eyebrow">${challenge.cadence} · ${challenge.xp} XP / ${challenge.tokens} tokens</span><h3>${challenge.name}</h3>
      <p>${challenge.target} ${challenge.metric === "team" ? "assists, revives or objective stages" : challenge.metric}</p>
      ${meter(value, challenge.target, challenge.name)}
      ${claimButton("challenge", id, period, value >= challenge.target, progress?.claimed.includes(id))}</article>`;
  }).join("")}</div>`;
  if (tab === "season") {
    const seasons = [...new Set([season.id, ...Object.keys(c.seasons)])].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    return `<p>${season.name} ends ${new Date(season.endsAt).toISOString().slice(0,10)} UTC. New seasons start a fresh ranking and track;
      lifetime XP, equipment, badges and old earned track rewards remain yours. No paid track.</p>
      ${seasons.map((id) => {
      const progress = c.seasons[id] || { xp: 0, claimed: [] };
      return `<details class="career-season" ${id === season.id ? "open" : ""}><summary>Season ${Number(id.slice(1)) + 1} · ${progress.xp.toLocaleString()} earned XP</summary>
        <div class="career-grid">${Array.from({ length: SEASON_TIERS }, (_, index) => {
        const tier = index + 1;
        return `<article><h3>Tier ${tier}${tier === 4 ? " · Aurora finish" : ""}</h3><p>${tier * 20} tokens · ${tier * SEASON_TIER_XP} match XP</p>
          ${claimButton("season", String(tier), id, progress.xp >= tier * SEASON_TIER_XP, progress.claimed.includes(tier))}</article>`;
      }).join("")}</div></details>`;
    }).join("")}`;
  }
  if (tab === "honors") return `<h3>Achievement showcase · ${c.achievements.length} / ${Object.keys(ACHIEVEMENTS).length}</h3>
    <div class="career-grid">${Object.entries(ACHIEVEMENTS).map(([id, badge]) =>
    `<article class="career-badge ${c.achievements.includes(id) ? "earned" : ""}"><span class="eyebrow">${c.achievements.includes(id) ? "Badge earned" : "Locked badge"}</span><h3>${badge.name}</h3><p>${badge.description}</p></article>`).join("")}</div>
    <h3>Prestige ${c.prestige}</h3><p>Voluntary service ranks. Nothing is reset: all lifetime XP, campaign progress, guns, outfits and mastery stay intact.
      Each new rank costs a higher cumulative earned-match-XP threshold and grants 250 tokens.</p>
    ${meter(c.prestigeXp, prestigeRequired(c.prestige), "Prestige earned match XP")}
    ${claimButton("prestige", String(c.prestige + 1), "lifetime", c.prestigeXp >= prestigeRequired(c.prestige), false)}`;
  const weapon = WEAPONS[weaponId], level = masteryLevel(c.weaponXp[weaponId] || 0);
  const kit = c.loadouts[weaponId] || { attachmentId: "none", finishId: "standard" };
  const options = (definitions, selected, unlocked) => Object.entries(definitions).map(([id, item]) =>
    `<option value="${id}" ${id === selected ? "selected" : ""} ${unlocked(id, item) ? "" : "disabled"}>${item.name}${unlocked(id, item) ? "" : ` · ${item.level ? `Weapon level ${item.level}` : item.playerLevel ? `Player level ${item.playerLevel}` : item.classId ? `${SQUAD_CLASSES[item.classId].name} level 3` : "Season tier 4"}`}</option>`).join("");
  return `<p>Player level ${profile.level} · Prestige ${c.prestige}. Mastery is earned in PvE matches, not the range or Free-for-All.
    Equipment changes apply before deployment; FFA uses standard handling and no perks.</p>
    <div class="career-grid">${Object.entries(SQUAD_CLASSES).map(([id, role]) => {
    const xp = c.classXp[id] || 0, rank = masteryLevel(xp, "class");
    return `<article><h3>${role.name} · Level ${rank} / 20</h3>${meter(xp, rank < 20 ? classLevelXp(rank + 1) : classLevelXp(20), `${role.name} mastery`)}</article>`;
  }).join("")}</div>
    <label for="careerWeapon">Weapon mastery and equipment</label><select id="careerWeapon">
    ${profile.ownedWeapons.map((id) => `<option value="${id}" ${id === weaponId ? "selected" : ""}>${WEAPONS[id].name}</option>`).join("")}</select>
    <h3>${weapon.name} · Level ${level} / 25</h3>${meter(c.weaponXp[weaponId] || 0, level < 25 ? weaponLevelXp(level + 1) : weaponLevelXp(25), "Weapon mastery")}
    <p>20 weapon XP per server-confirmed PvE elimination, saved at match settlement. First control grip: 2 eliminations / 40 XP.</p>
    <div class="career-grid"><article><label for="careerAttachment">Attachment</label>
      <select id="careerAttachment" data-career-equip="attachment">${options(ATTACHMENTS, kit.attachmentId, (_id, item) => level >= item.level)}</select>
      <p>${ATTACHMENTS[kit.attachmentId].description}</p></article>
    <article><label for="careerFinish">Weapon finish</label><select id="careerFinish" data-career-equip="finish">
      ${options(WEAPON_FINISHES, kit.finishId, (id, item) => id === "aurora" ? Object.values(c.seasons).some((s) => s.claimed.includes(4)) : level >= item.level)}</select>
      <p>Cosmetic coating, visible on your gun and to your squad.</p></article>
    <article><label for="careerPerk">Operator perk</label><select id="careerPerk" data-career-equip="perk">
      ${options(PERKS, c.perkId, (id) => perkUnlocked(profile, id))}</select><p>${PERKS[c.perkId].description}</p></article></div>`;
}

export function mountCareer(socket, { getProfile, updateProfile }) {
  const panel = document.createElement("dialog");
  panel.id = "careerPanel";
  panel.className = "career-panel";
  panel.setAttribute("aria-labelledby", "careerTitle");
  panel.innerHTML = `<header class="panel-heading"><div><span class="eyebrow">Operator service record</span><h2 id="careerTitle">Career & rewards</h2></div>
    <button class="secondary" id="careerClose" autofocus>Close</button></header>
    <div class="career-tabs" role="group" aria-label="Career sections">${["loadout", "contracts", "season", "honors"].map((id) =>
    `<button class="secondary" data-career-tab="${id}" aria-pressed="${id === "loadout"}">${id[0].toUpperCase() + id.slice(1)}</button>`).join("")}</div>
    <p id="careerError" class="error" role="status" aria-live="polite"></p><div id="careerContent"></div>`;
  document.querySelector("#game").append(panel);
  let tab = "loadout", weaponId, pending = false, serverNow = Date.now(), synchronizedAt = Date.now(), generation = 0;
  const message = (text) => { panel.querySelector("#careerError").textContent = text; };
  function render() {
    if (!getProfile() || !panel.open) return;
    weaponId ||= getProfile().equippedWeaponId;
    panel.querySelector("#careerContent").innerHTML = careerMarkup(getProfile(), { tab, weaponId,
      now: serverNow + Date.now() - synchronizedAt });
    for (const button of panel.querySelectorAll("[data-career-tab]")) button.setAttribute("aria-pressed", String(button.dataset.careerTab === tab));
    panel.setAttribute("aria-busy", String(pending));
    if (pending) for (const input of panel.querySelectorAll("#careerContent button, #careerContent select")) input.disabled = true;
  }
  function request(event, input) {
    if (pending) return;
    if (!socket.connected) return message("Connection lost. Reconnect before changing your career.");
    pending = true; message(""); render();
    const version = generation;
    const callback = (error, result) => {
      if (version !== generation) return;
      pending = false;
      if (error || !result?.ok) message(error ? "Career request timed out. Retry safely; rewards are claimed once." : result?.error || "Career request failed.");
      else {
        if (result.serverNow) { serverNow = result.serverNow; synchronizedAt = Date.now(); }
        updateProfile(result.profile);
      }
      render();
    };
    if (input === undefined) socket.timeout(6000).emit(event, callback);
    else socket.timeout(6000).emit(event, input, callback);
  }
  for (const button of document.querySelectorAll(".career-open")) button.onclick = () => {
    if (!getProfile()) return;
    panel.showModal(); weaponId = getProfile().equippedWeaponId; render(); request("careerStatus");
  };
  panel.querySelector("#careerClose").onclick = () => panel.close();
  panel.addEventListener("close", () => { generation++; pending = false; });
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button?.dataset.careerTab) { tab = button.dataset.careerTab; message(""); render(); }
    if (button?.dataset.careerClaim) request("claimProgression",
      { type: button.dataset.careerClaim, key: button.dataset.key, period: button.dataset.period });
  });
  panel.addEventListener("change", (event) => {
    if (event.target.id === "careerWeapon") { weaponId = event.target.value; render(); }
    else if (event.target.dataset.careerEquip) request("equipProgression",
      { kind: event.target.dataset.careerEquip, id: event.target.value,
        ...(event.target.dataset.careerEquip === "perk" ? {} : { weaponId }) });
  });
  socket.on("profile", render);
  socket.on("disconnect", () => { if (panel.open) { pending = false; message("Connection lost. Reconnect before claiming or equipping."); render(); } });
  for (const event of ["joined", "matchStarted", "banned"]) socket.on(event, () => panel.close());
  return { render };
}
