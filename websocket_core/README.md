# retterm-game-websocket-core

Shared websocket transport core for game projects.

Scope:

- typed-envelope JSON RPC request/response/event contracts
- binary frame codec compatible with the Minecraft transport shape
- session control helpers (`x-rpchub-session-id`, hello/draining payload)
- current-session store helpers for manager-side routing
- connection state tracking
- pending request map + response matching

Non-goals:

- no plain/untyped protocol fallback
- no built-in Axum router
- no built-in websocket server/client runtime
- no game-specific RPC actions

This crate is intended to be used by both manager-side and server-side runtimes.
The outer application owns the actual websocket loop and plugs incoming text/binary
frames into `PeerCore`.
