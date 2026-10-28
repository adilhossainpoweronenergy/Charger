const $ = id => document.getElementById(id);
let allLogs = [];
let messageCount = 0;
let expanded = new Set();
let socket;
let wsBase = "";

async function init() {
  try {
    const res = await fetch("/config");
    const config = await res.json();
    wsBase = config.wsBase;
    $("endpoint").textContent = `${wsBase}{CHARGE_POINT_ID}`;
  } catch {
    $("endpoint").textContent = "Could not load endpoint. Check server connection.";
  }
  connectDashboard();
}
function connectDashboard() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const token = new URLSearchParams(location.search).get("token");
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  socket = new WebSocket(`${scheme}//${location.host}/dashboard-ws${tokenQuery}`);
  socket.onopen = () => {
    $("liveStatus").className = "pill online";
    $("liveStatus").innerHTML = "<span></span> Dashboard connected";
  };
  socket.onclose = () => {
    $("liveStatus").className = "pill offline";
    $("liveStatus").innerHTML = "<span></span> Reconnecting…";
    setTimeout(connectDashboard, 2000);
  };
  socket.onerror = () => socket.close();
  socket.onmessage = event => {
    const payload = JSON.parse(event.data);
    if (payload.type === "init") {
      allLogs = payload.data.messages || [];
      renderChargers(payload.data.chargePoints || []);
      renderLogs();
    } else if (payload.type === "event") {
      const item = payload.data;
      allLogs.push(item);
      if (allLogs.length > 500) allLogs.shift();
      if (item.direction === "charger→CSMS") messageCount++;
      $("messageCount").textContent = messageCount;
      $("lastActivity").textContent = new Date(item.timestamp).toLocaleTimeString();
      renderLogs();
      refreshChargersFromEvents();
    }
  };
}
function refreshChargersFromEvents() {
  // Current live connection state is sent in the dashboard init; system events update the visible list.
  const map = new Map();
  document.querySelectorAll("#chargers tr[data-id]").forEach(tr => map.set(tr.dataset.id, tr));
  const latest = new Map();
  allLogs.forEach(e => { if (e.chargePointId && e.direction === "system") latest.set(e.chargePointId, e.summary); });
  for (const [id, summary] of latest) {
    const existing = map.get(id);
    const isConnected = summary === "Charger connected";
    if (existing) {
      const status = existing.querySelector(".status");
      if (status) { status.className = `status ${isConnected ? "connected" : ""}`; status.textContent = isConnected ? "Connected" : "Disconnected"; }
    } else {
      const tbody = $("chargers");
      const empty = tbody.querySelector(".empty"); if (empty) empty.parentElement.remove();
      const tr = document.createElement("tr"); tr.dataset.id = id;
      tr.innerHTML = `<td><strong></strong></td><td><span class="status">Disconnected</span></td><td>—</td><td>—</td>`;
      tr.querySelector("strong").textContent = id;
      tbody.prepend(tr);
      const status = tr.querySelector(".status");
      status.className = `status ${isConnected ? "connected" : ""}`; status.textContent = isConnected ? "Connected" : "Disconnected";
    }
  }
  const connected = [...document.querySelectorAll("#chargers .status.connected")].length;
  $("connectedCount").textContent = connected;
}
function renderChargers(chargers) {
  const tbody = $("chargers");
  if (!chargers.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Waiting for chargers…</td></tr>';
    $("connectedCount").textContent = "0";
    return;
  }
  tbody.innerHTML = "";
  chargers.forEach(c => {
    const tr = document.createElement("tr"); tr.dataset.id = c.id;
    tr.innerHTML = `<td><strong></strong></td><td><span class="status ${c.connected ? "connected" : ""}">${c.connected ? "Connected" : "Disconnected"}</span></td><td></td><td></td>`;
    tr.children[0].querySelector("strong").textContent = c.id;
    tr.children[2].textContent = c.connectedAt ? new Date(c.connectedAt).toLocaleString() : "—";
    tr.children[3].textContent = c.remoteAddress || "—";
    tbody.appendChild(tr);
  });
  $("connectedCount").textContent = chargers.filter(c => c.connected).length;
}
function renderLogs() {
  const filter = $("filter").value;
  const items = allLogs.filter(e => filter === "all" || (filter === "ocpp" && e.direction === "charger→CSMS") || (filter === "system" && e.direction === "system")).slice().reverse();
  const tbody = $("logs");
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No events to show. Connect a charger to begin.</td></tr>';
    return;
  }
  tbody.innerHTML = "";
  items.forEach((e, i) => {
    const key = `${e.timestamp}-${i}`;
    const tr = document.createElement("tr");
    const direction = e.direction || "system";
    tr.innerHTML = `<td></td><td><span class="direction ${direction === "system" ? "system" : ""}"></span></td><td></td><td></td><td><button class="secondary frame-button">${e.raw ? "View JSON" : "—"}</button></td>`;
    tr.children[0].textContent = new Date(e.timestamp).toLocaleTimeString();
    tr.children[1].querySelector("span").textContent = direction;
    tr.children[2].textContent = e.chargePointId || "—";
    tr.children[3].textContent = e.messageType || e.summary || "Event";
    const btn = tr.children[4].querySelector("button");
    if (!e.raw) btn.disabled = true;
    btn.addEventListener("click", () => {
      const detail = tr.nextElementSibling;
      if (detail && detail.classList.contains("detail-row")) { detail.remove(); btn.textContent = "View JSON"; }
      else {
        const d = document.createElement("tr"); d.className = "detail-row";
        const cell = document.createElement("td"); cell.colSpan = 5;
        const pre = document.createElement("pre"); pre.className = "raw-frame"; pre.textContent = e.raw;
        cell.appendChild(pre); d.appendChild(cell); tr.after(d); btn.textContent = "Hide JSON";
      }
    });
    tbody.appendChild(tr);
  });
}
$("filter").addEventListener("change", renderLogs);
$("clearLog").addEventListener("click", () => { allLogs = []; messageCount = 0; $("messageCount").textContent = "0"; renderLogs(); });
$("refresh").addEventListener("click", () => location.reload());
$("copyEndpoint").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("endpoint").textContent); $("copyEndpoint").textContent = "Copied"; setTimeout(() => $("copyEndpoint").textContent = "Copy", 1200); }
  catch { alert("Copy unavailable. Select and copy the endpoint text."); }
});
init();