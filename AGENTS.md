# Workspace Notes

- This folder contains libraries intended only for game projects. This includes both Rust crates and npm packages.
- None of the libraries under this folder have ever been formally launched in production.
- Do not preserve backward compatibility by default.
- Prefer clean changes over compatibility shims, migration layers, deprecated aliases, or legacy branches.
- If an API, type, contract, package export, route, or behavior needs to change to simplify the design, change it directly unless the user explicitly asks to keep compatibility.
- Treat these libraries as internal game-facing building blocks, not as public general-purpose libraries.
- Optimize for clarity and maintainability for current game projects, not for third-party consumers.
- When a mature page or module already exists in one game, move it here and make the game keep only a thin wrapper.
- Do not introduce “first phase”, “temporary”, or placeholder shared components. Shared code must come from a proven in-repo implementation.

## Auto Restart

- Auto restart for game servers belongs in shared manager modules, not in per-game duplicated state machines.
- The shared module owns the retry loop, success and failure rules, and the blocked-state rules.
- Game managers may keep only adapters for instance enumeration, runtime-state sync, persistence updates, and lifecycle start dispatch.
- Success is fixed to `running` continuously for 60 seconds.
- Retry interval is fixed to 10 seconds.
- The blocked threshold is fixed to 5 consecutive failures.
- Automatic restart only applies to abnormal stops. Manual stop, install, reinstall, suspend, and undeployed states are excluded.
