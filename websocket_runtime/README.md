# retterm-game-websocket-runtime

Runtime layer for manager/server websocket communication.

Scope:

- `tokio-tungstenite` based socket runtime
- generic websocket stream loop
- URL and UDS client connection helpers
- reconnect and heartbeat
- reliable handling for RPC request/response and binary frames
- best-effort handling only for event traffic when configured

Non-goals:

- no protocol fallback beyond the typed envelope defined in `websocket_core`
- no `axum`
- no HTTP router or upgrade handler
- no game-specific dispatch logic

Use this crate together with `retterm-game-websocket-core`.
