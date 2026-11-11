import { WEAPONS } from "../shared/weapons.js";
import { skinFor } from "../shared/skins.js";
import { eventContentAvailable } from "../shared/events.js";
import { ATTACHMENTS, effectiveWeapon, equippedKit, WEAPON_FINISHES } from "../shared/career.js";

const accents = ["#8da482", "#82a6bd", "#b6a882", "#afa0c8", "#bd9680", "#92aaa2"];
const weaponIds = Object.keys(WEAPONS).filter((id) => eventContentAvailable(id));
const accentFor = (id) => accents[weaponIds.indexOf(id) % accents.length];
const preview = (weapon) => `<img src="/weapon-previews/${weapon.id}.png" alt="" width="320" height="160" loading="lazy" decoding="async" />`;

export function loadoutMarkup(profile, player = null, connected = true) {
  if (!profile) return '<p class="loadout-waiting">Your loadout will appear when connected.</p>';
  if (!Object.hasOwn(WEAPONS, profile.equippedWeaponId) || !Array.isArray(profile.ownedWeapons) ||
    profile.ownedWeapons.some((id) => !Object.hasOwn(WEAPONS, id))) throw new TypeError("Invalid saved loadout.");
  const id = player ? player.weaponId : profile.equippedWeaponId;
  if (!Object.hasOwn(WEAPONS, id)) throw new TypeError("Invalid active loadout.");
  if (player && (!Number.isSafeInteger(player.ammo) || player.ammo < 0 ||
    !Number.isSafeInteger(player.reserve) || player.reserve < 0)) throw new TypeError("Invalid loadout ammunition.");
  const kit = player || equippedKit(profile, id, profile.classId);
  const weapon = effectiveWeapon(id, kit);
  const skin = skinFor(player?.skinId || profile.equippedSkinId || "standard");
  const owned = Object.values(WEAPONS).filter((item) => eventContentAvailable(item.id) && profile.ownedWeapons.includes(item.id));
  const ammo = player ? player.ammo : weapon.magSize, reserve = player ? player.reserve : weapon.reserve;
  const status = !connected ? "Last synced" : player ? player.reloading ? "Reloading" : player.unlimitedAmmo ? "Practice" : "In mission" : "Ready to deploy";
  const slots = owned.map((item, index) => `<li class="weapon-slot${item.id === id ? " equipped" : ""}"
      style="--slot-accent:${accentFor(item.id)}">
      <div class="slot-heading"><span>${String(index + 1).padStart(2, "0")}</span><span>${item.id === id ? "Equipped" : "Collected"}</span></div>
      ${preview(item)}<strong>${item.name}</strong><small>${item.category}</small>
    </li>`).join("");
  return `<div class="loadout-heading"><h3>Your loadout</h3><span>${status}</span></div>
    <div class="loadout-active" style="--slot-accent:${accentFor(id)}">
      <div class="slot-heading"><span>Active weapon</span><span>${weapon.fireMode === "semi" ? "Semi-auto" : "Automatic"}</span></div>
      ${preview(weapon)}<strong>${weapon.name}</strong><small>${weapon.category}</small>
    </div>
    <dl class="loadout-meta"><div><dt>${player ? "Magazine" : "Starting magazine"}</dt><dd>${ammo} / ${weapon.magSize}</dd></div>
      <div><dt>${player ? "Reserve" : "Starting reserve"}</dt><dd>${player?.unlimitedAmmo ? "Unlimited" : `${reserve} rounds`}</dd></div>
      <div class="loadout-optic"><dt>Optic</dt><dd>${weapon.optic.label}</dd></div>
      <div class="loadout-optic"><dt>Attachment / finish</dt><dd>${ATTACHMENTS[kit.attachmentId || "none"].name} / ${WEAPON_FINISHES[kit.finishId || "standard"].name}</dd></div>
      <div class="loadout-optic"><dt>Outfit</dt><dd>${skin.name}</dd></div></dl>
    <details class="loadout-collection"><summary>Collected guns <span>${owned.length} / ${weaponIds.length}</span></summary>
      <ul class="weapon-slots" aria-label="Collected guns">${slots}</ul>
    </details>
    <p class="loadout-note">${player ? "You carry one gun. This collection is saved, not extra carried slots." :
      "Choose a gun below before deploying. New guns found in loot equip immediately."}</p>`;
}
