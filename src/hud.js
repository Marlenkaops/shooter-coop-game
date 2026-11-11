const markupByElement = new WeakMap();

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

export function ammoHeaderMarkup(label, tokens) {
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new RangeError("Invalid HUD token balance.");
  return `<div class="ammo-header"><span class="hud-label">${escapeHtml(label)}</span><div class="hud-ammo-wallet" aria-label="Token balance"><span>Tokens</span><strong data-token-balance>${tokens.toLocaleString()}</strong></div></div>`;
}

export function setHudMarkup(element, markup) {
  if (markupByElement.get(element) === markup) return false;
  element.innerHTML = markup;
  markupByElement.set(element, markup);
  return true;
}
