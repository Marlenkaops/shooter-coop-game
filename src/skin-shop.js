import { SKINS } from "../shared/skins.js";
import { TOKENS_PER_KILL } from "../shared/weapons.js";

export function skinShopMarkup(profile) {
  if (!profile) return "<p>Your outfits will appear when connected.</p>";
  const owned = profile.ownedSkins || ["standard"];
  return `<div class="shop-wallet"><strong>${profile.tokens.toLocaleString()} tokens</strong>
      <small>Earn ${TOKENS_PER_KILL} tokens for each NPC elimination. Cosmetics only; no combat bonuses.</small></div>
    <div class="skin-cards">${Object.values(SKINS).map((skin) => {
      const equipped = (profile.equippedSkinId || "standard") === skin.id, collected = owned.includes(skin.id);
      return `<article class="skin-card${equipped ? " equipped" : ""}" style="--skin-accent:${skin.accent}">
        <img src="/skin-previews/${skin.id}.png" alt="${skin.name} outfit preview" width="240" height="320" loading="lazy" decoding="async" />
        <h4>${skin.name}</h4><p>${skin.description}</p>
        <small>${collected ? equipped ? "Equipped" : "Owned" : `${skin.cost} tokens`}</small>
        <button type="button" class="secondary" data-skin="${skin.id}" data-skin-action="${collected ? "equipSkin" : "buySkin"}"
          ${equipped || !collected && profile.tokens < skin.cost ? "disabled" : ""}>${equipped ? "Equipped" :
            collected ? "Equip outfit" : profile.tokens < skin.cost ? `Need ${skin.cost - profile.tokens} more` : `Buy · ${skin.cost} tokens`}</button>
      </article>`;
    }).join("")}</div><div class="skin-shop-error error" role="status" aria-live="polite"></div>`;
}
