export function mountMenuNavigation(root) {
  const controls = () => {
    const dialog = root.querySelector("dialog[open]");
    const modal = root.querySelector(".admin-panel:not(.hidden), .ban-screen");
    const surface = dialog || modal || root.querySelector("#pause:not(.hidden), .screen:not(.hidden)");
    return surface ? [...surface.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]")]
      .filter((node) => node.getClientRects().length && !node.closest("[hidden], .hidden")) : [];
  };
  function move(direction) {
    const items = controls();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = index < 0 ? direction > 0 ? 0 : items.length - 1 :
      (index + direction + items.length) % items.length;
    items[next].focus({ preventScroll: true });
    document.activeElement.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  root.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select") || event.target.isContentEditable) return;
    if (event.code === "ArrowDown" || event.code === "ArrowUp") {
      if (!controls().length) return;
      event.preventDefault();
      event.stopPropagation();
      move(event.code === "ArrowDown" ? 1 : -1);
    }
  });
  let interval, held = false;
  const poll = () => {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    const down = pad?.buttons[13]?.pressed || pad?.axes[1] > .65;
    const up = pad?.buttons[12]?.pressed || pad?.axes[1] < -.65;
    const accept = pad?.buttons[0]?.pressed;
    const back = pad?.buttons[1]?.pressed;
    const right = pad?.buttons[15]?.pressed || pad?.axes[0] > .65;
    const left = pad?.buttons[14]?.pressed || pad?.axes[0] < -.65;
    if (!held) {
      if (down || up) move(down ? 1 : -1);
      if (right || left) {
        const node = document.activeElement, direction = right ? 1 : -1;
        if (node?.matches('input[type="range"]')) {
          node.value = String(Math.max(Number(node.min), Math.min(Number(node.max),
            Number(node.value) + direction * Number(node.step || 1))));
          node.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (node?.tagName === "SELECT") {
          const options = [...node.options].filter((option) => !option.disabled);
          if (options.length) {
            const index = options.findIndex((option) => option.value === node.value);
            node.value = options[Math.max(0, Math.min(options.length - 1, index + direction))].value;
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else move(direction);
      }
      if (accept && controls().includes(document.activeElement)) {
        const node = document.activeElement;
        if (node.tagName === "SUMMARY") node.parentElement.open = !node.parentElement.open;
        else node.click();
      }
      if (back) {
        const dialog = root.querySelector("dialog[open]");
        if (dialog) dialog.close();
        else root.querySelector("#pause:not(.hidden) #resume")?.click();
      }
    }
    held = Boolean(down || up || accept || back || right || left);
  };
  addEventListener("gamepadconnected", () => { interval ??= setInterval(poll, 80); });
  addEventListener("gamepaddisconnected", () => {
    if ([...(navigator.getGamepads?.() || [])].some(Boolean)) return;
    clearInterval(interval); interval = undefined; held = false;
  });
  if ([...(navigator.getGamepads?.() || [])].some(Boolean)) interval = setInterval(poll, 80);
}
