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

## Archive Manager

- Archive work for game files belongs in shared server modules, not in per-game manager sagas and not in per-game duplicated zip handlers.
- The shared archive manager owns queueing, execution, cancellation, short-lived task retention, and path safety checks.
- Shared frontend files pages must surface the archive queue through one consistent dropdown entrypoint inside the file manager toolbar.
- Game-specific frontends may keep only thin wrappers around the shared files page and must not fork archive queue UI or archive API contracts.

## Frontend Panel Scope

- `game/share_lib/frontend` 内的面板级共享代码必须把样式作用域限制在子应用根容器或 `:host`。
- 统一使用 `data-game-panel-root` 作为挂载容器标记；共享 bootstrap 工具和共享页面默认以这个标记作为样式范围入口。
- 不允许在 shared frontend 新增会直接作用到宿主 `html`、`body`、`:root`、全局 `.dark` 或裸 `*` 的基础样式。
- 如果共享组件需要主题变量、字体、背景、边框或表单基础规则，必须写成 `[data-game-panel-root]` 或 `:host` 范围内的规则。
