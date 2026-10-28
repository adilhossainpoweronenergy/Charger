# OCPP Live Monitor (OCPP 1.6J)

A small deployable website that exposes a WebSocket endpoint for OCPP 1.6J charge-point simulators and displays received frames live in a browser dashboard.

## What it does
- Public WebSocket endpoint pattern: `wss://YOUR-DOMAIN/ocpp/CP_01`
- Requests the `ocpp1.6` WebSocket subprotocol.
- Displays incoming OCPP JSON frames, including CALL, CALLRESULT and CALLERROR.
- Shows connected charge point IDs and connection/disconnection events.
- Keeps the most recent 500 events in server memory (not persistent storage).

## Deploy online (Render example)
1. Create a GitHub repository and upload the contents of this folder.
2. On Render, create **New + → Web Service** and connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Optionally set environment variable `DASHBOARD_TOKEN` to a long random secret to protect the live dashboard WebSocket. If set, open the dashboard as `https://YOUR-SERVICE.onrender.com/?token=YOUR_TOKEN`. Keep the token private; the static dashboard page itself is public, so this is not full access control.
5. Deploy. Use the generated `https://YOUR-SERVICE.onrender.com` website.
6. In your charger simulator, set the URL to `wss://YOUR-SERVICE.onrender.com/ocpp/CP_01`. Replace `CP_01` with the Charge Point ID configured in the simulator. Select OCPP 1.6J / `ocpp1.6`.
7. Open the website to view received frames.

The host must support WebSocket upgrades and HTTPS. Its HTTPS endpoint is used by chargers as WSS. Do not add `/dashboard-ws` to the charger URL.

## Run locally
Requires Node.js 20+.
```bash
npm install
npm start
```
Open `http://localhost:8080`. For a simulator running on another machine, localhost is not publicly reachable; deploy to a cloud host or use a secure tunnel for testing.

## Security and production limitations
This is a prototype receiver, not a certified production CSMS.
- Do not use it to control real chargers or connect it to public infrastructure without a security review.
- OCPP endpoint currently identifies a station by its URL path. Add charger authentication (for example, TLS client certificates or a verified per-station credential), rate limits, connection limits, and audit controls before real use.
- Set `DASHBOARD_TOKEN` to protect the dashboard WebSocket and open the dashboard as `https://YOUR-DOMAIN/?token=YOUR_TOKEN`. Implement a proper login before public production use.
- `ALLOWED_ORIGINS` can be set to a comma-separated list of allowed browser origins. OCPP chargers often omit the Origin header.
- Events are kept in memory and disappear on restart. Add persistent storage if you need historical logs.
- The server logs OCPP frames; avoid sending personal or payment-card data.
- This starter logs OCPP frames but does not yet implement server-initiated OCPP commands (RemoteStartTransaction, RemoteStopTransaction, SetChargingProfile, etc.) or full CSMS workflows.

## OCPP URL format
`wss://YOUR-DOMAIN/ocpp/CHARGE_POINT_ID`

Example:
`wss://your-service.onrender.com/ocpp/CP_01`

The server expects OCPP-J JSON messages and negotiates the `ocpp1.6` WebSocket subprotocol.
