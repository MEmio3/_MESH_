# MESH — Deep Dive: Why Calls Don't Work, and How to Rebuild the Networking Layer

> Status: diagnostic + architecture document.
> Scope: the call / voice / streaming / relay subsystem, the signaling layer, and a
> ground-up plan for offline-first (intranet, CGNAT, Bluetooth, LAN-cluster) operation.
> Audience: you (the maintainer) — written to be actionable, not marketing.

---

## 0. TL;DR (read this first)

Three things are simultaneously true and together they explain *everything* you are seeing:

1. **There is no STUN and no working TURN in the actual call path.** `iceServers` is
   hard-coded to `[]` ([`webrtc.ts:52`](../src/renderer/src/lib/webrtc.ts)). With an empty
   ICE list, WebRTC only ever gathers **host candidates** (your raw LAN IPs). That means
   two clients connect **only if they are on the same L2/L3 subnet**. The moment they are
   on different networks — or behind the same CGNAT with different `100.64.x.x` addresses —
   there is no server-reflexive candidate and no relay candidate, so ICE has nothing to
   try and the connection silently fails. *This is the core reason calls "don't work."*

2. **The relay (TURN) system is wired up but never actually completes a single link in
   its own chain.** The relay starts, but it is never registered, its credentials are
   never propagated, discovery never queries the server, and even the local config that
   *is* read drops the TURN username/password. So even when you flip "Contribute as Relay"
   on, nothing downstream can use it. (Details in §3.)

3. **It is not an SFU. It is a full-mesh P2P topology.** Every participant opens a
   PeerConnection to every other participant and `addTrack`s their media to *all* of them
   ([`webrtc.ts:100-198`, `voice.store.ts`](../src/renderer/src/lib/webrtc.ts)). For a 1:1
   call that's fine. For "stream my monitor to 15 people," your uplink has to send the
   **same encoded video N times**. That is the streaming inefficiency you hit — and it is
   a *topology* problem, not a codec/bitrate problem. (Details in §5.)

The good news: the signaling server, perfect-negotiation logic, media capture, and UI are
genuinely solid. The break is concentrated in **ICE configuration + relay discovery**, which
is a self-contained layer you can fix or replace without touching the rest.

---

## 1. What MESH Is Supposed To Do

MESH is a decentralized, privacy-first Discord-style app (Electron + React + Zustand,
SQLite for local state, libsodium for crypto). The defining product goal:

> **Let friends talk, voice-chat, video-call and screen/monitor-share even when the open
> internet is unavailable or unusable** — over a LAN, over an intranet, between users stuck
> behind the *same* carrier-grade NAT (CGNAT), and (aspirationally) over Bluetooth or a
> local Wi-Fi cluster — with end-to-end encryption.

The architecture chosen to do this:

| Layer | Tech in repo | Role |
|------|--------------|------|
| Signaling | `socket.io` server, embeddable in the Electron main process ([`signaling.ts`](../src/server/signaling.ts), [`signaling-host.ts`](../src/main/signaling-host.ts)) | Exchanges SDP offers/answers/ICE, presence, friend reqs, server rooms |
| Media transport | Browser `RTCPeerConnection` in the renderer ([`webrtc.ts`](../src/renderer/src/lib/webrtc.ts)) | Carries audio/video/screen + a data channel |
| NAT traversal | `node-turn` in-process TURN relay ([`relay-manager.ts`](../src/main/relay-manager.ts)) | Relay media when direct P2P is impossible |
| Network introspection | `nat-upnp` + `os.networkInterfaces` ([`network-scanner.ts`](../src/main/network-scanner.ts), [`signaling-host.ts`](../src/main/signaling-host.ts)) | Tell the user which IP to share |

The intent is "host-is-the-server" P2P: whoever creates a community server runs the
signaling for it; media flows peer-to-peer; a TURN relay is used only as a fallback.

---

## 2. The Real Failure: ICE Has Nothing To Work With

### 2.1 How WebRTC actually connects (the part that's missing)

ICE needs three *kinds* of candidate to be robust:

- **host** — your local interface IPs (`192.168.x`, `100.64.x`, `10.x`). Gathered for free.
- **srflx (server-reflexive)** — your public-facing `ip:port` as seen from outside,
  discovered by asking a **STUN** server. This is what enables **UDP hole punching** —
  the trick that lets two NATed peers talk directly without a relay.
- **relay** — a `ip:port` on a **TURN** server that forwards packets when hole punching
  fails (symmetric NAT, CGNAT hairpin blocked, etc.).

MESH currently gathers **only host candidates**:

```ts
// webrtc.ts:51-53
// Empty by default — pure P2P, no external STUN/TURN
private iceServers: RTCIceServer[] = []
private iceTransportPolicy: RTCIceTransportPolicy = 'all'
```

```ts
// webrtc.ts:104-107
const pc = new RTCPeerConnection({
  iceServers: this.iceServers,          // []  ← no STUN, no TURN
  iceTransportPolicy: this.iceTransportPolicy
})
```

**Consequence matrix:**

| Both peers' situation | Host candidates enough? | Result today |
|---|---|---|
| Same Wi-Fi / same subnet | ✅ yes | **Works** |
| Same router, different VLAN | ⚠️ sometimes | flaky |
| Different networks, public IPs | ❌ need srflx/relay | **Fails** |
| Behind same ISP **CGNAT** | ❌ need srflx (hole punch) or relay | **Fails** |
| Different ISPs | ❌ need relay | **Fails** |

So "works on my LAN, dead everywhere else" is the exact, predictable symptom of an empty
`iceServers`. Nothing about the SDP exchange, perfect negotiation, or media capture is
wrong — ICE simply never produces a candidate pair that can cross the NAT.

### 2.2 Why "no STUN by default" was a design mistake for *this* goal

The comment says "pure P2P, no external STUN/TURN" — a privacy stance (don't leak your IP
to Google's STUN). That is reasonable *as a default*, but it conflicts with the product
goal. You don't need a *public* STUN server. **You need a STUN responder reachable on the
same network the peers share.** On an intranet/CGNAT, you can and should run your own
STUN. `node-turn` already *is* a STUN server (TURN is a superset of STUN). So the relay
host can double as the STUN responder — and that costs zero privacy because it's *your*
box on *your* network.

---

## 3. The Relay System: A Broken Chain, Link by Link

When you toggle **Settings → Relay → "Contribute as Relay"**, this is what is *supposed* to
happen end-to-end, and where each step actually dies:

```
[A] Start node-turn ........................ ✅ works (relay-manager.startRelay)
[B] Figure out the reachable IP for it ..... ❌ never computed
[C] Register relay with signaling server ... ❌ never called from UI
[D] Server stores it & hands back an id .... ❌ contract mismatch (no id returned)
[E] Heartbeat to keep it alive ............. ❌ no heartbeat sender (expires in 60s)
[F] Other peers discover it (/get-relays) .. ❌ discovery never queries the server
[G] Client builds turn: URL + credentials .. ❌ credentials dropped
[H] WebRTC uses it ......................... ❌ never reached
```

Let's nail each one with the code.

### [A] The relay starts — this part is fine

`relay-manager.startRelay` creates a `node-turn` server with **long-term auth** and a
random password ([`relay-manager.ts:45-86`](../src/main/relay-manager.ts)):

```ts
server = new TurnServer({
  listeningPort: port,                 // 3478
  authMech: 'long-term',               // ← REQUIRES username + password
  credentials: { [username]: password },
  realm: 'mesh.relay'
})
```

`authMech: 'long-term'` is the critical detail: **any client that wants an allocation must
present `username='relay'` and this exact `password`.** Hold that thought for step [G].

### [B] The "right IP" problem you described

You said the server is *"unable to fetch the right IP... not just realIp but the IP to be
used to communicate with other users within the network."* You're exactly right, and here
is the gap:

- [`network-scanner.ts`](../src/main/network-scanner.ts) *can* discover all three layers
  (local IP, router WAN IP via UPnP, public IP via ipify) and even classifies CGNAT.
- [`signaling-host.ts`](../src/main/signaling-host.ts) `detectLocalIps()` enumerates every
  non-internal IPv4 and labels it `home` / `isp` / `public`.
- **But none of that output is ever fed into relay registration.** `registerWithSignaling`
  takes an `address` parameter ([`relay-manager.ts:119-148`](../src/main/relay-manager.ts))
  that the caller is expected to supply — and there is no caller, and nothing computes the
  correct one. There is no logic that says "for an `isp-local` relay, advertise my
  `100.64.x` / `10.x` interface address; for a `global` relay, advertise the UPnP-mapped
  public IP."

So the relay never knows what address to publish, and even if it did, the address is never
turned into a `turn:<ip>:<port>` URL anywhere.

### [C] Registration is never triggered

`RelaySettings.handleToggleContributing` calls `window.api.relay.start(...)`
([`RelaySettings.tsx:54`](../src/renderer/src/pages/settings/RelaySettings.tsx)) — and then
**stops**. It never calls `relay.register`. The IPC handler `relay:register` exists
([`ipc-handlers.ts:1213`](../src/main/ipc-handlers.ts)) but has no caller. So the relay
runs locally, invisible to everyone including yourself.

### [D] Even if [C] fired, the server contract is mismatched

`registerWithSignaling` POSTs `{ address, scope, credentials }` and then does
`const data = await response.json() as { id: string }` and uses `data.id`
([`relay-manager.ts:125-144`](../src/main/relay-manager.ts)).

But the embedded signaling server's handler is:

```ts
// signaling.ts:33-38
app.post('/register-relay', (req, res) => {
  const { id, address, scope } = req.body          // ← reads `id` FROM the request
  relays.set(id, { id, address, scope, lastHeartbeat: Date.now(), users: 0 })
  res.json({ ok: true })                           // ← returns NO id
})
```

Two bugs in one:
- The server expects the **client** to send `id`, but the client doesn't send one → the
  relay is stored under key `undefined`.
- The server returns `{ ok: true }`, not `{ id }` → on the client, `data.id` is `undefined`
  → the local DB row is written with id `undefined`
  ([`relay-manager.ts:135-141`](../src/main/relay-manager.ts)).

It also silently **ignores the `credentials`** the client sends. So the signaling registry
has no idea what password the relay expects.

### [E] No heartbeat → 60-second death

The server expires any relay that hasn't heartbeaten in 60s
([`signaling.ts:47-70`](../src/server/signaling.ts)), and `/heartbeat-relay` exists
([`signaling.ts:52`](../src/server/signaling.ts)) — but **nothing ever calls it.** There is
no timer in `relay-manager` posting heartbeats. So a relay (if it ever registered) vanishes
within a minute.

### [F] Discovery never asks the server

Here's the one that surprises people. The ICE config is built from the **local SQLite DB**,
not from the signaling server's live registry:

```ts
// settings.store.ts:18-19
const relays = await window.api.db.relays.list()         // ← local DB only
const iceServers: RTCIceServer[] = relays.map((r) => ({ urls: r.address }))
```

The server's `GET /get-relays` endpoint ([`signaling.ts:47-50`](../src/server/signaling.ts))
— the thing that would let peer B learn about peer A's relay — is **never fetched by
anyone.** So relays are not actually shared across the mesh at all. Each client only knows
about relays it manually typed into "Custom Relays."

### [G] Credentials are dropped — the silent TURN killer

This is the bug that bites you even if you do everything manually. Suppose you paste
`turn:10.0.0.5:3478` into Custom Relays. The ICE config becomes:

```ts
{ urls: "turn:10.0.0.5:3478" }     // ← no `username`, no `credential`
```

But the relay runs `authMech: 'long-term'`. A TURN `ALLOCATE` with no credentials gets a
**401 Unauthorized**, the browser cannot get a relay candidate, and ICE falls back to...
host candidates only (which we already know don't cross NAT). The relay is "configured" and
100% useless. The `RTCIceServer` *type* supports `username`/`credential`; the code just
never populates them, and they're never stored or transmitted anywhere to begin with.

### [H] Reachability — the part that's hard even after fixing A–G

Two users behind the **same ISP CGNAT** share one public IP but have different internal
`100.64.x` addresses. For one to host a relay the other can reach, the relay's port must be
reachable across the carrier NAT — and **CGNAT hairpinning is usually blocked**, and you
can't port-forward on a router you don't control. `nat-upnp` is imported but only used for
`externalIp()` ([`network-scanner.ts:26-31`](../src/main/network-scanner.ts)); it never
calls `portMapping()` to actually open a port. So even a perfectly-registered relay may not
be reachable in the exact CGNAT scenario MESH is built for. (Mitigations in §6.4.)

---

## 4. The Signaling Server: Mostly Fine, A Few Sharp Edges

The socket.io signaling is the healthiest part of the stack. Voice-room dedup, perfect
negotiation, host-as-server lifecycle, offline queue — all thoughtfully done. Issues worth
knowing:

- **Module-level singleton server.** `signaling.ts` creates `app`/`httpServer`/`io` at
  import time ([`signaling.ts:15-17`](../src/server/signaling.ts)). After
  `stopSignalingServer()` calls `io.close()`, the same `httpServer` instance can't cleanly
  `listen()` again in all cases. Restart-after-stop is fragile.
- **`offline_queue.json` path.** Written to `process.cwd()`
  ([`signaling.ts:158`](../src/server/signaling.ts)). In a packaged Electron app `cwd` is
  often the install dir (read-only) → write failures. Should be `app.getPath('userData')`.
- **Transport is `websocket`-only** with `reconnection: false`
  ([`socket-client.ts:41-44`](../src/main/socket-client.ts)), and reconnection is hand-rolled.
  Works, but you lose socket.io's battle-tested backoff and the polling fallback that helps
  on restrictive networks.
- **No authentication on signaling.** Any socket can emit `server:kick`, `server:ban`,
  `register-user` for *any* userId. Fine for friends-only LAN; a real problem if you ever
  expose signaling beyond trusted peers. (See §7 on identity/crypto.)

These don't block calls today — the ICE/relay gap does — but they'll bite during the
offline-first push.

---

## 5. The Streaming Problem: You Don't Have an SFU, You Have a Mesh

You wrote *"It uses SFU... net speed becomes inefficient."* Important correction: **there is
no SFU in this codebase.** The signaling server only forwards SDP/ICE; it never touches
media. Media is **full mesh**:

```ts
// webrtc.ts — on every new peer, your media is added to THAT peer's connection
for (const track of this.localScreenStream.getTracks()) {
  pc.addTrack(track, this.localScreenStream)   // repeated per peer
}
```

```
        FULL MESH (today)                         SFU (what you want for big audiences)
   A───────B                                          A
   │ \   / │                                          │
   │  \ /  │                                       ┌──┴── SFU ──┐
   │  / \  │                                       │     │      │
   C───────D                                       B     C      D
  every peer uploads to every peer          streamer uploads ONCE to SFU,
  (N−1 uploads of the same frame)           SFU fans out to N viewers
```

### 5.1 Why mesh kills monitor-sharing

If you screen-share 1080p60 (~8–12 Mbps encoded) to 10 viewers, mesh makes **your** uplink
send 80–120 Mbps. Most home/CGNAT uplinks are 10–40 Mbps. You saturate, packets drop,
WebRTC congestion control collapses the bitrate, everyone sees a slideshow. The viewers'
downlinks are fine — it's the *publisher's* uplink that dies. Mesh is correct up to ~4–6
people in a symmetric call and wrong for one-to-many streaming.

### 5.2 Is SFU the answer for *local* use? Partly.

- **For one-to-many (you stream, many watch): yes, an SFU is the right tool**, even locally
  — but a *LAN-local* SFU, not a cloud one. On a LAN the SFU's fan-out bandwidth is cheap
  (gigabit switch), so it's nearly free. The win is: publisher uploads **once**.
- **For symmetric small-group voice (4–6 friends): mesh is actually better** — lower
  latency, no central box, no extra hop. Keep it.
- **The optimization that matters most regardless of topology: simulcast / SVC.** Let the
  publisher send 2–3 quality layers; the SFU (or, in mesh, the publisher) forwards the layer
  each viewer can handle. Today everyone gets the full 1080p60 stream whether their link can
  take it or not.

### 5.3 Recommended hybrid

```
participants ≤ 5  AND no active screen-share   →  full mesh P2P   (lowest latency)
participants > 5   OR  someone is monitor-sharing → route media through a LAN SFU
```

This is exactly what mature apps do (Discord uses an SFU for everything; Jitsi switches
mesh→SFU at a threshold). For MESH's "geeks on an intranet" use case, a **self-hosted SFU
that any peer can spin up the same way they spin up the TURN relay** fits the philosophy
perfectly.

---

## 6. The Fix Plan — Two Tiers

### 6.1 Tier 1: Make calls work this week (minimal, surgical)

These changes are small and stay inside the existing architecture.

1. **Add a STUN responder and use it.** `node-turn` already answers STUN. When a relay is
   running locally, register `stun:<lan-ip>:3478` into every client's `iceServers`. For the
   common "same LAN, different subnet / same CGNAT" case this alone restores hole punching
   without any relay traffic.
   - Minimum viable even simpler: ship a tiny embedded STUN, or (privacy permitting) make
     "use public STUN" an opt-in toggle so non-CGNAT users get cross-internet P2P instantly.

2. **Stop dropping TURN credentials.** Change the relay record to carry
   `{ address, username, credential }` and build the ICE server fully:
   ```ts
   { urls: r.address, username: r.username, credential: r.credential }
   ```
   Plumb `username`/`credential` through: DB schema, `db.relays.list()`, the registration
   payload, and `applyIceConfig` ([`settings.store.ts:18-25`](../src/renderer/src/stores/settings.store.ts)).

3. **Fix the register/discover contract.** Make `/register-relay` **generate** the id and
   return `{ id }`; store `credentials`. Have clients **GET `/get-relays`** on connect and
   feed *those* into `applyIceConfig` (not just the local DB).

4. **Actually call `relay.register` and start a heartbeat** when "Contribute as Relay" is
   enabled. Pick the advertised address from `detectLocalIps()` by scope: `isp-local` →
   the `10.x`/`100.64.x` interface; `global` → UPnP-mapped public IP.

5. **Open the port via UPnP** for `global` relays: call `nat-upnp` `portMapping()` for
   UDP/TCP 3478 (best-effort, ignore failure).

After 1–4, two friends on the same CGNAT or the same office LAN get working voice/video.
That is the headline fix.

### 6.2 Tier 1.5: De-flake the signaling

- Move `offline_queue.json` to `userData`.
- Rebuild `app`/`httpServer`/`io` inside `startSignalingServer` instead of at module load,
  so stop→start is clean.
- Add a shared-secret or identity-signed handshake before honoring `server:*` mutations.

### 6.3 Tier 2: The ground-up rebuild (the part you asked about)

If you're rebuilding the transport layer, here's the stack I'd choose for MESH's goals.

**Keep:** Electron + React + Zustand + libsodium + SQLite + the whole UI. The rebuild is
**network-layer only.**

**Media:** move off raw `RTCPeerConnection` plumbing to a thin abstraction with a pluggable
backend:

| Concern | Recommendation | Why |
|---|---|---|
| Small symmetric calls | Keep mesh (`RTCPeerConnection`) | Lowest latency, no infra |
| One-to-many / screen-share | **mediasoup** (SFU) embedded as a "host can run an SFU" toggle | Battle-tested, runs as a Node lib in the main process, simulcast/SVC built in, LAN-friendly |
| Codec | VP9/AV1 SVC for video; Opus for audio | SVC lets one upload serve many quality tiers |
| Adaptivity | Enable **simulcast** on every published video track | Stops one slow viewer dragging everyone down |

**Signaling:** keep socket.io but treat the server as **stateless relay of signed
messages**. Identity, room membership, and authz come from libsodium signatures, not from
trusting socket ids.

**Discovery (this is where offline-first lives):** a layered discovery service —

1. **mDNS / DNS-SD (Bonjour)** for same-LAN zero-config peer & service discovery
   (`_mesh._udp.local`). No signaling server needed at all on a LAN: peers find each other,
   exchange signed SDP directly. *This is the single highest-leverage addition for your
   "blackout, no internet" goal.*
2. **Signaling server** (host-as-server) for intranet/CGNAT where mDNS doesn't cross
   subnets.
3. **Manual exchange** (copy/paste or QR of a signed connection blob) as the ultimate
   no-infrastructure fallback — two people in a true blackout can connect by showing each
   other a QR code.

### 6.4 CGNAT specifically

Layered, in order of preference:
1. **STUN hole punching** between the two `100.64.x` peers (works more often than people
   think if the carrier NAT is full-cone or address-restricted).
2. **A relay hosted by a peer who *is* reachable** (e.g., someone on the LAN with a public
   IP, or the office gateway box). With Tier-1 fixes this finally works.
3. **A community/"cluster" relay** — see §8.

---

## 7. Encryption: Where It Stands and What's Missing

You have `libsodium-wrappers` and an `identity` system (Ed25519/X25519-style keypairs by the
look of `identity.ts`/`types/identity.ts`). What to make sure is true in the rebuild:

- **WebRTC media/data are already DTLS-SRTP encrypted hop-by-hop** — that's transport
  security, free with WebRTC. Good for mesh (it *is* end-to-end because there's no middle).
- **But an SFU terminates DTLS** — media is decryptable at the SFU. For a self-hosted,
  friend-run SFU on your own LAN that may be acceptable; if not, you need **E2EE via WebRTC
  Insertable Streams / `RTCRtpScriptTransform`** with keys derived from your libsodium
  identities, so even the SFU only sees ciphertext.
- **Sign your signaling.** Every offer/answer/ICE and every `server:*` command should be
  signed by the sender's identity key and verified by recipients. This closes the "any
  socket can kick anyone" hole (§4) and authenticates relays so you don't connect media
  through a hostile box.
- **Authenticate relays/SFUs.** Pin the relay's public key in the registration record so a
  client knows the `turn:` box it's about to trust is the one the host actually ran.

---

## 8. The "Geek" Features: Intranet, Bluetooth, Wi-Fi Cluster

These are genuinely achievable; here's the honest engineering reality of each.

### 8.1 Pure intranet (no internet) — *easy, do this first*
- Run the **embedded signaling server** on any one machine; everyone points
  `signalingUrl` at its LAN IP. Already supported by `signaling-host.ts`.
- Add **mDNS discovery** so users don't even have to type the IP (§6.3).
- Run a **local STUN/TURN** (the `node-turn` box) so cross-subnet intranet works.
- This is the most reliable offline mode and needs only the Tier-1 fixes + mDNS.

### 8.2 Local Wi-Fi "cluster" / central node — *medium*
- Designate one beefy machine as the **cluster node**: it runs signaling **+** STUN/TURN
  **+** (optionally) the mediasoup SFU. Everyone on the WLAN connects to it.
- This is your "central wifi bluster" idea, and it's exactly how you'd serve a *monitor
  stream to a large number of people* efficiently on a LAN: publisher → SFU once → switch
  fans out at gigabit. Net-speed inefficiency solved because the expensive fan-out happens
  on wired LAN, not the publisher's uplink.
- A **soft-AP mode** (one laptop hosts a Wi-Fi hotspot, others join it) gives you a network
  with *no router and no internet at all* — true blackout comms. The hotspot host is
  naturally the cluster node.

### 8.3 Bluetooth pairing — *hard, niche, but cool*
- Bluetooth Classic / BLE is **not a WebRTC transport** and has tiny bandwidth (BLE
  ~1–2 Mbps real-world; far too little for video, marginal for low-bitrate Opus voice).
- Realistic uses:
  - **Out-of-band pairing / key exchange**: use BLE to exchange identity public keys and a
    connection blob (like how headphones pair), then bring the *actual* call up over Wi-Fi
    Direct / soft-AP. BLE as the "handshake," Wi-Fi as the "pipe." This is the sweet spot.
  - **Bluetooth PAN (BNEP)** can carry IP between two devices for text/voice in a deep
    blackout, but it's OS-permission-heavy and Electron can't do it directly — you'd need a
    native addon (Node `noble`/`bleno`, or a small Rust/Go sidecar over `node-bluetooth`).
- **Recommendation:** ship BLE as a *pairing & discovery* mechanism (high value, achievable)
  and treat BLE-as-media-transport as a research spike, not a v1 promise.

### 8.4 Wi-Fi Direct / Wi-Fi Aware — *medium-hard, the real blackout MVP*
- **Wi-Fi Direct** (Android/Windows) lets two devices form a direct link with no AP and no
  internet, at real Wi-Fi speeds — enough for video. This, not Bluetooth, is the right
  "no infrastructure" media path. Needs native/OS integration (a sidecar), but it's the
  feature that delivers the dream: full-quality calls with literally no network.

---

## 9. Concrete Optimization Checklist (independent of the rebuild)

These improve quality even before any topology change:

- [ ] **Enable simulcast** on published video/screen tracks (`addTransceiver` with
      `sendEncodings`). Biggest single quality win for multi-viewer.
- [ ] **Pick a screen-share codec/bitrate by intent**: monitor-sharing motion video vs.
      sharing a mostly-static document need very different bitrate/framerate. The current
      HD = 1080p60 flat ([`voice.store.ts:379-383`](../src/renderer/src/stores/voice.store.ts))
      wastes bandwidth on static content. Add a "Text/Smooth Motion" toggle that maps to
      `contentHint = 'detail' | 'motion'`.
- [ ] **Cap framerate for screen share** to 15–30 fps unless the user opts into 60. Halves
      bitrate for free.
- [ ] **Set `degradationPreference`**: `maintain-resolution` for monitor/text,
      `maintain-framerate` for camera.
- [ ] **Bound the data-channel file backpressure** smarter — current fixed 1 MB threshold
      with `setTimeout(50)` ([`webrtc.ts:657-659`](../src/renderer/src/lib/webrtc.ts)) is
      fine but `bufferedAmountLowThreshold` + the `onbufferedamountlow` event is cleaner.
- [ ] **Trickle ICE is already used** (good) — just make sure candidates aren't sent before
      `setRemoteDescription` on the answer side under the perfect-negotiation path.
- [ ] **Add ICE/connection diagnostics to the UI**: surface `iceConnectionState`,
      selected-candidate-pair type (host/srflx/relay), and RTT. Right now you have *no
      visibility* into why a call failed — adding this would have made this entire diagnosis
      a 30-second glance.

---

## 10. Suggested Build Order (so it stays incremental)

1. **Diagnostics first** — show ICE state + candidate types in the call UI. (You'll *see*
   the empty-candidate problem yourself.)
2. **STUN** — wire a STUN responder (local relay's, or opt-in public). Fixes most calls.
3. **TURN credential plumbing + register/discover/heartbeat** — fixes CGNAT/cross-net.
4. **UPnP port mapping** for global relays.
5. **mDNS discovery** — removes "type the IP" friction; enables zero-config LAN.
6. **Simulcast + content-hint optimizations** — better quality, no topology change.
7. **Embedded mediasoup SFU** behind the mesh→SFU threshold — fixes large-audience streaming.
8. **Signed signaling + relay key pinning** — security hardening.
9. **Soft-AP / Wi-Fi Direct sidecar** — the true-blackout media path.
10. **BLE pairing** — out-of-band key exchange + discovery.

Each step is independently shippable and independently testable. Steps 1–3 are the ones that
turn "calls don't work" into "calls work."

---

## 11. File Reference Map (for whoever does the work)

| File | What lives here | Touch in which step |
|---|---|---|
| [`src/renderer/src/lib/webrtc.ts`](../src/renderer/src/lib/webrtc.ts) | PeerConnection mgr, ICE config, mesh fan-out | 1,2,3,6 |
| [`src/renderer/src/stores/settings.store.ts`](../src/renderer/src/stores/settings.store.ts) | `applyIceConfig` (drops credentials, ignores `/get-relays`) | 2,3 |
| [`src/main/relay-manager.ts`](../src/main/relay-manager.ts) | node-turn lifecycle, registration, **needs heartbeat + address logic** | 3,4 |
| [`src/server/signaling.ts`](../src/server/signaling.ts) | socket.io + relay registry (**id/credential contract bug**) | 3, 1.5 |
| [`src/main/network-scanner.ts`](../src/main/network-scanner.ts) | IP/CGNAT detection (**output unused by relay**) | 3,4 |
| [`src/main/signaling-host.ts`](../src/main/signaling-host.ts) | embedded signaling + `detectLocalIps()` | 3,5 |
| [`src/main/socket-client.ts`](../src/main/socket-client.ts) | client socket, hand-rolled reconnect | 1.5 |
| [`src/renderer/src/hooks/useSignaling.ts`](../src/renderer/src/hooks/useSignaling.ts) | IPC→WebRTC glue, offer/answer/ICE routing | 1 (diagnostics) |
| [`src/renderer/src/stores/voice.store.ts`](../src/renderer/src/stores/voice.store.ts) | voice room join/leave, stream quality | 6 |
| [`src/renderer/src/pages/settings/RelaySettings.tsx`](../src/renderer/src/pages/settings/RelaySettings.tsx) | relay UI (**never calls register**) | 3 |

---

## 12. One-Paragraph Answer to "Why doesn't it work?"

Because the call layer gathers only **host ICE candidates** (`iceServers: []`), so it can
only connect peers that already share a subnet; and the relay that's supposed to rescue the
other cases is a **broken chain** — it's never registered, its **address is never computed**
from the IP scanner that already knows it, the register/discover server contract returns no
id and drops the credentials, there's no heartbeat so it'd expire anyway, discovery never
queries the server, and the one config path that does run **omits the TURN
username/password** the relay requires. On top of that, the media topology is **full mesh,
not an SFU**, so monitor-sharing to many people saturates the publisher's uplink. Fix ICE
(STUN + real TURN credentials + working registration/discovery), then add a LAN SFU for
one-to-many, and the system does what it was designed to do.
