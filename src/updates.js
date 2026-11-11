import { RELEASE } from "./release.js";

export function mountUpdates(socket, { canAutoShow = () => true } = {}) {
  const panel = document.querySelector("#updatesPanel");
  const list = document.querySelector("#updateChanges");
  document.querySelector("#updateRelease").textContent = RELEASE.title;
  document.querySelector("#updateDate").textContent = RELEASE.date;
  for (const [heading, description] of RELEASE.changes) {
    const item = document.createElement("li"), title = document.createElement("strong"), body = document.createElement("p");
    title.textContent = heading;
    body.textContent = description;
    item.append(title, body);
    list.append(item);
  }
  let autoShown = false;
  const open = () => { if (!panel.open) panel.showModal(); };
  const close = () => { if (panel.open) panel.close(); };
  const dismiss = () => {
    localStorage.setItem("lastLightSeenRelease", RELEASE.id);
    close();
  };
  document.querySelector("#updatesClose").onclick = dismiss;
  for (const button of document.querySelectorAll(".updates-open")) button.onclick = open;
  panel.addEventListener("cancel", (event) => { event.preventDefault(); dismiss(); });
  socket.on("identity", () => {
    if (autoShown || localStorage.getItem("lastLightSeenRelease") === RELEASE.id || !canAutoShow() ||
      document.querySelector("dialog[open], #adminPanel:not(.hidden), #reportPanel:not(.hidden)")) return;
    autoShown = true;
    open();
  });
  for (const event of ["joined", "matchStarted", "banned"]) socket.on(event, close);
  return { close };
}
