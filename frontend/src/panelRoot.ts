export const GAME_PANEL_ROOT_ATTR = "data-game-panel-root";

export function markGamePanelRoot(container: HTMLElement) {
  container.setAttribute(GAME_PANEL_ROOT_ATTR, "");
}

export function unmarkGamePanelRoot(container: HTMLElement) {
  container.removeAttribute(GAME_PANEL_ROOT_ATTR);
}
