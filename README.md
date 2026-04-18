# MESH

<div align="center">

**Decentralized, Privacy-First Communication Platform**

Built with Electron, React, and WebRTC

[Download](#installation) · [Features](#features) · [Architecture](#architecture) · [Development](#development)

</div>

---

## Overview

MESH is a decentralized, peer-to-peer communication application that prioritizes privacy and direct connections. Unlike traditional messaging platforms that rely on central servers to store and route all communications, MESH establishes direct WebRTC connections between users for messages, voice calls, video calls, and file transfers.

When direct P2P connections aren't possible, MESH uses a distributed relay network (TURN servers) to route traffic without storing any message history or user data.

<!-- Hero Image -->
<p align="center">
  <img src="images/hero-banner.png" alt="MESH Application Overview" width="800" />
</p>

---

## Features

### Direct Messaging
- **End-to-end encrypted** 1-on-1 conversations
- **P2P data channels** for direct message delivery between friends
- **Message reactions** with emoji support
- **File attachments** up to 50MB with drag-and-drop support
- **Message editing** and deletion with edit history indicators
- **Online/Idle/Offline status** indicators for all friends

<p align="center">
  <img src="images/dm-chat-view.png" alt="Direct Messaging Interface" width="700" />
</p>

### Friend Management
- **Add friends** using their unique User ID
- **Friend requests** with accept/reject workflow
- **Nearby users** discovery on local network
- **Blocked users** management panel
- **Online friends** quick-access list

<p align="center">
  <img src="images/friends-list.png" alt="Friends List and Management" width="700" />
</p>

### Message Requests
- **Cold messaging** for non-friends (similar to Discord message requests)
- **Thread-based conversations** before accepting friend requests
- **Accept/Ignore/Block** options for incoming requests
- **Preview snippets** showing the first message

### Community Servers
- **Host your own server** with customizable name and icon
- **Text channels** organized into collapsible categories
- **Voice rooms** with spatial audio support
- **Moderation tools**: mute, kick, ban, and role management
- **Member list** with status indicators and search

<p align="center">
  <img src="images/server-text-channel.png" alt="Server Text Channel" width="700" />
</p>

### Voice & Video Calls
- **1-on-1 voice calls** with crystal-clear audio
- **Video calls** with camera selection
- **Screen sharing** (window or full-screen)
- **Picture-in-picture** self-preview during calls
- **Audio device selection** with input volume control
- **Mute/unmute** and video toggle controls

<p align="center">
  <img src="images/call-overlay.png" alt="Voice Call Interface" width="700" />
</p>

### Privacy & Security
- **Cryptographic identity** using Ed25519 keypairs
- **Local-only storage** for all messages and user data
- **No central database** storing user information
- **Optional visibility** toggle to hide from discovery
- **Block users** system-wide across DMs and servers

### Relay Network (TURN)
- **In-process TURN server** for users behind restrictive NATs
- **User-hosted relays** that register with the signaling network
- **Automatic fallback** when direct P2P fails
- **No message persistence** on relay servers

### Customization
- **Profile customization** with username and avatar color
- **Custom avatars** upload for profile picture
- **Appearance settings** (theme options)
- **Notification preferences** per conversation type

---

## Architecture

### Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                         MESH Architecture                    │
├─────────────────────────────────────────────────────────────┤
│  Renderer (React 19)           Main Process (Electron)      │
│  ├─ Components                 ├─ IPC Handlers              │
│  ├─ Pages                      ├─ SQLite Database           │
│  ├─ Stores (Zustand)           ├─ Signaling Client          │
│  └─ WebRTC Manager             └─ File/Avatar Managers      │
│                                                              │
│  Signaling Server (Socket.IO)  TURN Relay (node-turn)       │
│  ├─ User Discovery             ├─ STUN/TURN Protocol        │
│  ├─ Message Relay              ├─ Credential Management     │
│  └─ Server Coordination        └─ Traffic Relay             │
└─────────────────────────────────────────────────────────────┘
```

### Process Model

| Process | Technology | Responsibility |
|---------|------------|----------------|
| **Renderer** | React 19 + Vite | UI rendering, WebRTC, user interaction |
| **Main** | Electron | Window management, IPC, database, signaling |
| **Preload** | TypeScript | Secure bridge between renderer and main |
| **Signaling** | Socket.IO | User discovery, message relay, coordination |
| **TURN** | node-turn | Traffic relay for NAT traversal |

### Data Flow

#### Direct Message (P2P)
```
User A → WebRTC Data Channel → User B
         (direct connection)
```

#### Message Request (Signaling Relay)
```
User A → Signaling Server → User B
         (when no P2P channel exists)
```

#### Server Message
```
User A → Signaling Server → All Server Members
         (broadcast via Socket.IO rooms)
```

### Database Schema

MESH uses SQLite (via `better-sqlite3`) for local storage:

| Table | Purpose |
|-------|---------|
| `friends` | Friend list with status |
| `friend_requests` | Pending friend requests |
| `message_requests` | Cold message threads |
| `conversations` | DM conversation metadata |
| `messages` | DM message history |
| `servers` | Joined/hosted servers |
| `server_members` | Server membership |
| `server_channels` | Server text/voice channels |
| `server_messages` | Server message history |
| `blocked_users` | Blocked user list |
| `relays` | TURN relay configuration |
| `settings` | User preferences |

---

## Installation

### Windows

Download the latest installer from the [Releases](https://github.com/MEmio3/_MESH_/releases) page:

```
MESH-Setup-0.1.0.exe
```

**System Requirements:**
- Windows 10 or later (64-bit)
- 500MB free disk space
- Internet connection for signaling

### Linux

```bash
# AppImage (recommended)
chmod +x MESH-0.1.0.AppImage
./MESH-0.1.0.AppImage

# Debian/Ubuntu
sudo dpkg -i MESH-0.1.0.deb
```

---

## Development

### Prerequisites

- **Node.js** 20.x or later
- **npm** or **pnpm**
- **Git**

### Setup

```bash
# Clone the repository
git clone https://github.com/MEmio3/_MESH_.git
cd MESH

# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron in development mode |
| `npm run build` | Build for production |
| `npm run dist` | Create distributable installer |
| `npm run signaling` | Run standalone signaling server |
| `npm run dist:linux` | Build Linux packages |

### Project Structure

```
MESH/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Entry point
│   │   ├── ipc-handlers.ts      # IPC handler registration
│   │   ├── database.ts          # SQLite operations
│   │   ├── identity.ts          # Cryptographic identity
│   │   ├── socket-client.ts     # Signaling client
│   │   ├── signaling-host.ts    # Embedded signaling server
│   │   ├── relay-manager.ts     # TURN relay management
│   │   ├── avatar.ts            # Avatar file handling
│   │   └── file-manager.ts      # File transfer handling
│   │
│   ├── renderer/                # React renderer process
│   │   ├── src/
│   │   │   ├── components/      # Reusable UI components
│   │   │   ├── pages/           # Application pages
│   │   │   ├── stores/          # Zustand state stores
│   │   │   ├── hooks/           # Custom React hooks
│   │   │   ├── lib/             # Utilities (WebRTC, etc.)
│   │   │   └── types/           # TypeScript type definitions
│   │   └── index.html
│   │
│   ├── preload/                 # Preload scripts
│   │   ├── index.ts             # Context bridge
│   │   └── index.d.ts           # Type definitions
│   │
│   ├── server/                  # Standalone signaling server
│   │   └── signaling.ts
│   │
│   └── shared/                  # Shared types
│       └── types.ts
│
├── resources/                   # App icons and assets
├── images/                      # Documentation images
├── release/                     # Build output
├── package.json
├── electron.vite.config.ts
└── tsconfig.json
```

---

## Configuration

### Network Settings

Access via Settings > Network:

| Setting | Description | Default |
|---------|-------------|---------|
| Signaling URL | Server for user discovery | `http://localhost:3000` |
| ICE Strategy | Connection fallback behavior | `p2p-first` |
| Self-host signaling | Run embedded signaling server | Off |

### ICE Strategies

| Mode | Behavior |
|------|----------|
| **p2p-first** | Try direct P2P, fall back to relays |
| **relay-fallback** | Use relays when P2P fails |
| **relay-only** | Always use relays (maximum privacy) |

---

## Security Considerations

### Identity Generation

MESH generates an Ed25519 keypair on first launch:
- **Public key**: Used as your User ID (shared with others)
- **Private key**: Encrypted and stored locally, never transmitted
- **Signing**: Messages can be cryptographically signed

### Storage

| Data Type | Location | Encrypted |
|-----------|----------|-----------|
| Identity | `userData/identity.enc` | Yes (OS-level) |
| Messages | `userData/mesh.db` | No (local only) |
| Avatars | `userData/avatars/` | No (local only) |
| Files | `userData/files/` | No (local only) |

### Network Security

- All signaling uses Socket.IO over configurable transport
- TURN relays use time-limited credentials
- No message content stored on signaling server

---

## Troubleshooting

### Connection Issues

**Cannot connect to signaling server:**
1. Verify the signaling URL in Settings > Network
2. Enable "Self-host signaling" to run locally
3. Check firewall rules for the signaling port (default: 3000)

**P2P connection failing:**
1. Check ICE strategy in Settings > Network
2. Ensure relays are available (Settings > Network > Relay List)
3. Try restarting both clients

### Build Issues

**Native module errors:**
```bash
npm run postinstall
# Or manually rebuild
npx electron-rebuild
```

**TypeScript errors:**
```bash
npx tsc --noEmit
```

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository** and create a feature branch
2. **Follow the code style** (ESLint + Prettier)
3. **Test thoroughly** before submitting PR
4. **Document new features** in this README

### Areas for Contribution

- [ ] End-to-end encryption for messages
- [ ] Group DM support
- [ ] Server channel permissions
- [ ] Mobile application (React Native)
- [ ] Bots and integrations API
- [ ] Message search functionality

---

## License

MIT License - See [LICENSE](LICENSE) for details

---

## Acknowledgments

MESH is inspired by:
- [Discord](https://discord.com) - Server and channel structure
- [Session](https://getsession.org) - Privacy-focused messaging
- [PeerTube](https://joinpeertube.org) - Federated architecture

Built with:
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Socket.IO](https://socket.io/)
- [node-turn](https://github.com/legastero/turn.js)
- [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3)

---

<div align="center">

**MESH** - Connect directly. Stay private.

[Report Bug](https://github.com/MEmio3/_MESH_/issues) · [Request Feature](https://github.com/MEmio3/_MESH_/issues)

</div>
