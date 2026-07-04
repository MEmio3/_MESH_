# MESH v2 — From-Scratch Rebuild Blueprint

> Purpose: build the networking/calling layer **correctly the first time**. Every
> decision below exists because of a specific, confirmed failure in MESH v1
> (documented in `../docs/MESH_DEEP_DIVE.md`). Read §0 and §1 before writing any code —
> they are the two rules that, if followed, make the old bug class structurally
> impossible to reintroduce.

---

## 0. The One Rule That Matters

> **No client ever connects directly to another client. Every client connects only
> to a host it was told the address of. The host routes everything — text, voice,
> video, screen-share.**

This is a **star topology**, not mesh. It is the single architectural decision that
prevents every failure MESH v1 hit: NAT traversal races, CGNAT peer-to-peer,
mDNS `.local` candidates that can't resolve, "which IP do I use," calls that connect
sometimes and not others. All of those bugs share one root cause — *a client trying
to reach another client it can't reliably address*. If that never happens, that
whole bug class is gone by construction.

Text already worked this way in v1 (client → signaling server → client) and it
never had these problems. v2 makes **media** work the same way.

```
   v1 (mesh — broke):                v2 (star — robust):

      A───B                                A   B
      │ ╲ ╱ │   each peer must reach        ╲ ╱
      │  ╳  │   every other peer directly    HOST  ← known, configured IP
      │ ╱ ╲ │   → NAT/CGNAT/mDNS hell       ╱ ╲     routes text + audio + video
      C───D                                C   D    P2P is an opportunistic bonus,
                                                      never a requirement
```

Direct P2P between two clients on the same LAN is *allowed* as a latency
optimization, but it must always have a working fallback through the host. Never
ship a feature whose only path is client→client.

---

## 1. Why WebRTC Is Still The Right Choice (and how v1 misused it)

You asked "WebRTC or raw UDP — whichever actually works." Answer: **WebRTC, used
correctly.** Raw UDP means re-implementing, from scratch and correctly, all of://
jitter buffering, packet-loss concealment, adaptive bitrate/congestion control,
Opus/VP8/VP9 encoding pipelines, echo cancellation, NAT traversal, and encryption.
WebRTC already has all of this, battle-tested by Chrome/Firefox/Safari for a decade.
The problem in v1 was never WebRTC the technology — it was two specific misuses:

1. **It was used for direct peer-to-peer** (mesh), which needs NAT traversal
   between two arbitrary clients — the fragile case. **Fix: only use WebRTC
   client↔host.** The host has a known address; no traversal magic required.
2. **ICE was misconfigured** — empty `iceServers`, and separately, Chromium's
   mDNS-obfuscated local-IP candidates (`*.local`) failed to resolve on some LANs,
   breaking connections even between two machines one cable apart, with zero
   internet involved. Both are config bugs, not WebRTC limitations. §4 covers the
   exact fix.

**Verdict for v2:** WebRTC client↔host (via an embedded SFU), never client↔client
as a requirement. Raw UDP is kept only as an escape hatch for a text/control channel
if you want one outside WebRTC's data channel (optional, see §9).

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         HOST NODE                            │
│  (one physical machine per server/session — laptop, mini PC,  │
│   or a phone acting as hotspot)                               │
│                                                                │
│   ┌────────────┐   ┌────────────────┐   ┌──────────────────┐ │
│   │ Signaling  │   │  SFU (media)   │   │ STUN/TURN        │ │
│   │ (ws server)│   │  LiveKit /     │   │ (only needed for │ │
│   │            │   │  mediasoup     │   │  the opportunistic│ │
│   │            │   │                │   │  P2P shortcut)    │ │
│   └────────────┘   └────────────────┘   └──────────────────┘ │
│           all three bind to the SAME known LAN/host IP        │
└───────────────┬───────────────┬───────────────┬──────────────┘
                │               │               │
        ┌───────┴──┐     ┌──────┴───┐     ┌─────┴────┐
        │ Client A │     │ Client B │     │ Client C │
        │ (Electron)     │ (Electron)     │ (Electron/mobile)
        └──────────┘     └──────────┘     └──────────┘
```

Every client dials **one address**: the host. That address is either:
- typed in manually (LAN IP, always works, zero magic), or
- discovered via mDNS/Bonjour on the same LAN (convenience only), or
- shared as a QR code / connection blob (works with zero network infra at all).

---

## 3. Tech Stack Decision

| Layer | Choice | Why |
|---|---|---|
| Media transport | **WebRTC**, client↔host only | Battle-tested codecs, encryption, congestion control — don't reinvent |
| Media server (SFU) | **LiveKit** (self-hosted, single binary) — see §3.1 for the mediasoup alternative | Turnkey simulcast, recording, E2EE hooks, runs fully offline |
| Signaling | WebSocket (`ws` or socket.io) embedded in the host process | Same pattern that already worked reliably in v1 for text |
| Discovery | mDNS/Bonjour (`bonjour-service` or `mdns`) + manual IP + QR blob | Layered fallback, works with zero infrastructure |
| STUN/TURN (optional P2P shortcut only) | Self-hosted `coturn` or `node-turn` on the host | Never point at Google — see §4 |
| Identity/crypto | libsodium (`libsodium-wrappers`), Ed25519 identity keys | Reuse what already worked in v1 |
| E2EE for media | WebRTC Insertable Streams keyed from libsodium identities | So the SFU only forwards ciphertext, if desired |
| App shell | Electron + React + Zustand (reuse from v1 — it was fine) | No reason to redo UI layer |

### 3.1 LiveKit vs. mediasoup — pick one

**LiveKit (recommended default):**
- Ships as a single Go binary (`livekit-server`) plus official JS/Electron client SDK.
- Handles simulcast, SVC, adaptive stream, recording, and E2EE out of the box.
- Config is explicit: you set `rtc.node_ip` to the host's LAN address yourself —
  **no auto-detection, no guessing, no "which IP" bug.** This directly fixes the
  "server can't fetch the right IP" complaint from v1: you tell it, once, in a
  config file.
- Runs with zero internet: `livekit-server --config livekit.yaml --dev` binds to
  your LAN interface and that's it.

**mediasoup (alternative if you want it embedded in Node/Electron directly):**
- A library, not a binary — you write the SFU logic yourself in the host's Node
  process. More control, more code to own.
- Choose this only if bundling a separate binary is unacceptable for distribution.

**Default recommendation: start with LiveKit.** Swap to mediasoup later only if
you hit a real limitation — don't pre-optimize this choice.

---

## 4. The Exact NAT/mDNS Fixes (do these on day 1)

These are the specific, confirmed causes of "WebRTC didn't work offline" in v1.
Bake the fixes into the host and client setup from the start.

### 4.1 Chromium's mDNS-obfuscated local IPs (breaks LAN-only WebRTC)

Since Chromium ~M75, ICE candidates report `random-uuid.local` instead of your real
`192.168.x.x` address, for privacy. If mDNS multicast is blocked (common on
managed switches, some VPN adapters, some intranet setups), that hostname never
resolves and **the connection fails even with zero internet involved and both
machines on the same cable.**

**Fix — set this Electron command-line switch before `app.whenReady()`:**

```ts
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')
```

This makes ICE candidates carry the real LAN IP directly. No resolution step, no
multicast dependency, no chance of this specific failure ever recurring. **This
single line would have fixed a large fraction of the "voice/call doesn't work"
reports in v1.**

### 4.2 Never default to public STUN

Google's `stun.l.google.com:19302` works, but (a) it's an internet dependency you
explicitly don't want, and (b) it's irrelevant here anyway because in v2 clients
never need to discover their public-facing address for peer-to-peer — they connect
to a host on the LAN whose address is already known. **Do not add any public STUN
server to the default config.** If you want the *optional* P2P shortcut for two
clients on the same LAN, self-host your own STUN via `node-turn` or `coturn` and
point at that instead (§5).

### 4.3 Build ICE diagnostics into the UI from day one

Add a debug panel that shows, per connection: `iceConnectionState`,
`iceGatheringState`, and the selected candidate pair's type (`host` / `srflx` /
`relay`). This single feature would have turned every "calls don't work" report in
v1 into an instant diagnosis instead of a multi-hour investigation. Build it before
you build the call UI polish.

---

## 5. Self-Hosted STUN/TURN (only for the optional P2P shortcut)

Since all *required* connections are client→host, you technically don't need
STUN/TURN at all for correctness. Keep it only as an optimization: if two clients
are on the same LAN, they can optionally negotiate a **direct** low-latency P2P
media path instead of routing through the host, using a self-hosted STUN/TURN
server for the handshake. This must be:

- **Self-hosted** (`node-turn` or `coturn`), run by the host node — never a public
  service.
- **Fully optional** — if it fails, silently fall back to the host-routed path.
  Never let the P2P shortcut be a hard requirement or a single point of failure.
- **Configured with real long-term credentials** wired all the way through — a
  `turn:` URL with no `username`/`credential` is a silent no-op (this exact bug
  existed in v1 — the config was built but the credentials were dropped before
  reaching the client).

---

## 6. Discovery — How a Client Finds the Host

Layered, cheapest-first:

1. **mDNS/Bonjour service advertisement.** Host advertises `_mesh._tcp.local` on
   the LAN; clients browse for it. Zero typing, zero internet, works the moment
   both devices are on the same Wi-Fi/switch.
2. **Manual entry.** Host's LAN IP + port, typed or pasted. Always available as
   the ground-truth fallback — never remove this option.
3. **QR code / connection blob.** Host encodes `{ip, port, publicKey}` into a QR
   code; a second device scans it. Works even with **no shared network at all**
   if paired with a soft-AP (§8.2) — the true "blackout" path.

Never build a discovery mechanism that silently guesses an IP (this is what failed
in v1's relay address logic). Discovery either finds the host via explicit
advertisement/scan, or the user provides the address directly. No auto-detection
of "the right IP to use" — that ambiguity is exactly what broke last time.

---

## 7. Signaling Design

Keep it boring and centralized — this is the part of v1 that worked:

- WebSocket server embedded in the host process (same pattern as v1's
  `signaling-host.ts`, reused).
- Carries: room join/leave, presence, chat, and **WebRTC SDP offer/answer/ICE
  between each client and the SFU** (not between clients — the SFU is just
  another WebRTC peer from each client's point of view).
- **Sign every message** with the sender's libsodium identity key; the host
  verifies signatures before acting on privileged messages (kick/ban/mute). This
  closes a real gap from v1 (any raw socket could impersonate any user/command).
- Persist queued offline messages to `app.getPath('userData')`, not `process.cwd()`
  (v1 wrote to the working directory, which is read-only once packaged).

---

## 8. Offline Modes — What To Support and How

### 8.1 Pure LAN / intranet (build this first, it's the easiest and most reliable)
- One machine runs host (signaling + SFU + optional STUN/TURN).
- Others connect via LAN IP (manual or mDNS-discovered).
- With §4's mDNS fix and no public STUN dependency, this **just works**, entirely
  offline.

### 8.2 True blackout — no router, no internet at all
- Host device starts a **Wi-Fi hotspot / soft access point**.
- Other devices join that hotspot directly (it's now "the LAN").
- Host runs signaling + SFU on its own hotspot IP (typically `192.168.4.1` or
  similar depending on OS).
- Pair devices to the hotspot via QR code (SSID + password + host connection
  blob) so no one has to type a Wi-Fi password by hand.
- This is the actual mechanism for "communicate with zero infrastructure" — not
  Bluetooth (see below).

### 8.3 Bluetooth — use it for pairing, not for media
- BLE/Bluetooth Classic bandwidth (~1–2 Mbps real-world) is too low for video and
  marginal even for compressed voice.
- **Correct use:** Bluetooth as an out-of-band **pairing/handshake** step — two
  devices exchange identity public keys and a connection blob over BLE (like
  headphone pairing), then the actual call happens over the Wi-Fi hotspot (§8.2).
  BLE opens the door; Wi-Fi carries the call.
- Treat BLE-as-media-transport as a future research spike, not a v2 commitment.

### 8.4 Multiple hosts / larger deployments
- For bigger LAN parties, run one host per "cluster" (e.g., one beefy machine on
  a wired gigabit connection acts as the SFU for everyone on that Wi-Fi). Fan-out
  bandwidth on a LAN switch is effectively free, so a single host can serve many
  viewers of one screen-share without anyone's uplink being the bottleneck — this
  is what actually fixes the "streaming to a large number of people" problem from
  v1's full-mesh design.

---

## 9. Data Channel / Text — Keep It Simple

Text chat rides the same signaling WebSocket (already proven reliable in v1) or,
if you want it end-to-end encrypted peer-style even while host-routed, use a
WebRTC data channel to the SFU/host the same way media does. Don't build a second,
separate transport for text — one routing path for everything is the whole point
of §0.

If you specifically want a **raw-UDP fallback channel** independent of WebRTC
(e.g., for extremely constrained embedded/CLI clients that can't carry a full
WebRTC stack), it is reasonable to add a simple Node `dgram`-based line protocol
to the host for **text only**. Do not attempt to carry video over hand-rolled UDP
— that reimplements everything WebRTC already solved (§1).

---

## 10. Encryption

- WebRTC gives you DTLS-SRTP for free between each client and the host — this is
  transport security, on by default, no extra work.
- The SFU **can** decode media in order to route it (that's how SFUs work), so if
  you want true end-to-end privacy even from a friend-run host, add **WebRTC
  Insertable Streams** (`RTCRtpScriptTransform`) and encrypt frames with keys
  derived from each user's libsodium identity keypair before they ever reach the
  SFU. The SFU then only ever handles ciphertext.
- Sign all signaling messages (§7) so the host can't be spoofed into acting as an
  arbitrary user, and clients can verify the host's identity key before trusting
  it (pin it, similar to SSH host-key pinning).

---

## 11. Build Order (do not skip ahead)

1. **Diagnostics UI** — ICE state + candidate-pair type visible in the call UI (§4.3).
2. **Host process**: embedded signaling (WebSocket) + LiveKit binary, both bound
   to a config-specified LAN IP (no auto-detection).
3. **Client↔host WebRTC** for voice only, LAN-only, manual IP entry. Get this
   rock solid before adding anything else.
4. **mDNS discovery** — remove the need to type the IP on a LAN.
5. **Video + screen-share** through the same host connection, with simulcast
   enabled from the start (not bolted on later).
6. **Soft-AP / hotspot blackout mode** (§8.2) with QR pairing.
7. **Self-hosted STUN/TURN** for the optional same-LAN P2P shortcut — strictly
   additive, never required.
8. **E2EE via insertable streams** + signed signaling — hardening pass.
9. **Bluetooth pairing** as a QoL discovery/handshake convenience — last, optional.

Each step must be manually verified **with the host's internet connection
physically disabled** before moving to the next. That single test — pull the
ethernet cable / turn off Wi-Fi's internet uplink, keep the LAN up — is the
regression test that would have caught every issue v1 shipped with.

---

## 12. Checklist: Mistakes From v1 To Never Repeat

- [ ] Never require client→client direct connection for a core feature (§0).
- [ ] Never leave `iceServers: []` as the only path when the feature needs to
      cross more than one LAN segment — but also never point it at Google.
- [ ] Never let a relay/host's advertised address be auto-guessed — always
      explicit config (§3.1, §6).
- [ ] Never build a "register with server" flow without also verifying the
      server actually returns/stores what the client expects — test the full
      round trip, not each side in isolation (v1's relay `id`/credentials were
      silently dropped for months because no one checked the full loop).
- [ ] Never ship a TURN/relay config that can carry `urls` without `username`/
      `credential` — an unauthenticated TURN URL is a silent, invisible no-op.
- [ ] Never skip the mDNS `disable-features` switch on Electron (§4.1) — test
      LAN-only calls with zero internet before considering calling "done."
- [ ] Never ship a call feature without a visible ICE/connection diagnostics
      view — you cannot debug what you cannot see (§4.3).
- [ ] Never use full mesh for more than ~5 participants or for any
      screen/monitor share — route through the host/SFU instead (§8.4).
- [ ] Always test with the host machine's internet uplink physically disabled
      before calling a milestone complete (§11).

---

## 13. Reference

Full diagnosis of what specifically broke in MESH v1 and why: see
[`../docs/MESH_DEEP_DIVE.md`](../docs/MESH_DEEP_DIVE.md).
