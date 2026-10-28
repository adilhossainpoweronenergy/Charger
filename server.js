const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 8080;
const dashboardToken = process.env.DASHBOARD_TOKEN || "";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const dashboardClients = new Set();
const chargePoints = new Map();
const recentMessages = [];
const MAX_MESSAGES = 500;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function publish(event) {
  const record = { ...event, timestamp: new Date().toISOString() };
  recentMessages.push(record);
  if (recentMessages.length > MAX_MESSAGES) recentMessages.shift();
  const data = JSON.stringify({ type: "event", data: record });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}
function connectionSnapshot() {
  return [...chargePoints.entries()].map(([id, info]) => ({
    id, connected: info.ws.readyState === WebSocket.OPEN,
    connectedAt: info.connectedAt, remoteAddress: info.remoteAddress
  }));
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "OCPP 1.6J WebSocket Monitor" }));
app.get("/config", (_req, res) => {
  const proto = _req.headers["x-forwarded-proto"] || (_req.secure ? "https" : "http");
  const host = _req.headers["x-forwarded-host"] || _req.headers.host;
  res.json({ wsBase: `${proto === "https" ? "wss" : "ws"}://${host}/ocpp/`, dashboardProtected: Boolean(dashboardToken) });
});

const dashboardWss = new WebSocket.Server({ noServer: true });
const ocppWss = new WebSocket.Server({ noServer: true, handleProtocols: protocols => protocols.has("ocpp1.6") ? "ocpp1.6" : false });

server.on("upgrade", (req, socket, head) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); } catch { socket.destroy(); return; }
  const origin = req.headers.origin;
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return;
  }

  if (url.pathname === "/dashboard-ws") {
    if (dashboardToken && !safeEqual(url.searchParams.get("token"), dashboardToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return;
    }
    dashboardWss.handleUpgrade(req, socket, head, ws => dashboardWss.emit("connection", ws, req));
    return;
  }

  const match = url.pathname.match(/^\/ocpp\/([A-Za-z0-9._~-]{1,100})\/?$/);
  if (!match) { socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return; }
  if (req.headers["sec-websocket-protocol"] && !String(req.headers["sec-websocket-protocol"]).split(",").map(s => s.trim()).includes("ocpp1.6")) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return;
  }
  req.chargePointId = match[1];
  ocppWss.handleUpgrade(req, socket, head, ws => ocppWss.emit("connection", ws, req));
});

dashboardWss.on("connection", (ws) => {
  dashboardClients.add(ws);
  ws.send(JSON.stringify({
    type: "init",
    data: { chargePoints: connectionSnapshot(), messages: recentMessages }
  }));
  ws.on("close", () => dashboardClients.delete(ws));
});

ocppWss.on("connection", (ws, req) => {
  const id = req.chargePointId;
  const previous = chargePoints.get(id);
  if (previous && previous.ws.readyState === WebSocket.OPEN) previous.ws.close(4001, "Replaced by new connection");
  const info = {
    ws, connectedAt: new Date().toISOString(),
    remoteAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown"
  };
  chargePoints.set(id, info);
  publish({ direction: "system", chargePointId: id, summary: "Charger connected", remoteAddress: info.remoteAddress });
  ws.on("message", (raw, isBinary) => {
    const text = raw.toString();
    let parsed = null, messageType = "Unknown OCPP frame", uniqueId = "";
    try {
      parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        if (parsed[0] === 2) { messageType = `CALL · ${parsed[2] || "UnknownAction"}`; uniqueId = parsed[1] || ""; }
        else if (parsed[0] === 3) { messageType = "CALLRESULT"; uniqueId = parsed[1] || ""; }
        else if (parsed[0] === 4) { messageType = `CALLERROR · ${parsed[2] || "Error"}`; uniqueId = parsed[1] || ""; }
        else messageType = `OCPP frame type ${parsed[0]}`;
      }
    } catch {}
    publish({
      direction: "charger→CSMS", chargePointId: id, messageType, uniqueId,
      binary: Boolean(isBinary), raw: text, parsed
    });

    // Minimal OCPP 1.6J responses so a simulator can complete its boot sequence.
    // A CALLRESULT is [3, uniqueId, payload] and must reuse the request's unique ID.
    if (Array.isArray(parsed) && parsed[0] === 2 && typeof parsed[1] === "string") {
      const action = parsed[2];
      const payload = parsed[3] || {};
      let response = null;

      switch (action) {
        case "BootNotification":
          response = {
            status: "Accepted",
            currentTime: new Date().toISOString(),
            interval: 300
          };
          break;
        case "Heartbeat":
          response = { currentTime: new Date().toISOString() };
          break;
        case "StatusNotification":
        case "MeterValues":
        case "DiagnosticsStatusNotification":
        case "FirmwareStatusNotification":
        case "DataTransfer":
        case "LogStatusNotification":
        case "SecurityEventNotification":
          response = action === "DataTransfer"
            ? { status: "Accepted" }
            : {};
          break;
        case "Authorize":
          response = { idTagInfo: { status: "Accepted" } };
          break;
        case "StartTransaction":
          response = {
            transactionId: Math.floor(Date.now() / 1000),
            idTagInfo: { status: "Accepted" }
          };
          break;
        case "StopTransaction":
          response = { idTagInfo: { status: "Accepted" } };
          break;
        default:
          // Keep unsupported actions visible in the dashboard; avoid falsely
          // claiming the full OCPP action is implemented.
          break;
      }

      if (response && ws.readyState === WebSocket.OPEN) {
        const frame = JSON.stringify([3, parsed[1], response]);
        ws.send(frame);
        publish({
          direction: "CSMS→charger", chargePointId: id,
          messageType: `${action}.conf`, uniqueId: parsed[1],
          raw: frame, parsed: [3, parsed[1], response]
        });
      }
    }
  });
  ws.on("close", (code, reason) => {
    if (chargePoints.get(id)?.ws === ws) chargePoints.delete(id);
    publish({ direction: "system", chargePointId: id, summary: "Charger disconnected", closeCode: code, reason: reason.toString() });
  });
  ws.on("error", err => publish({ direction: "system", chargePointId: id, summary: "WebSocket error", error: err.message }));
});

server.listen(port, "0.0.0.0", () => console.log(`OCPP monitor listening on ${port}`));
