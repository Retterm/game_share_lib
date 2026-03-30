export function statusText(s?: string | null): string {
  const state = String(s || "").trim();
  if (!state) return "-";
  switch (state) {
    case "running":
      return "运行中";
    case "stopped":
      return "已停止";
    case "online":
      return "在线";
    case "offline":
      return "离线";
    case "installing":
      return "安装中";
    case "updating":
      return "更新中";
    case "deploying":
      return "部署中";
    case "deployed":
      return "已部署";
    case "pending_region":
      return "待选择区域";
    case "deploy_failed":
      return "部署失败";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "unknown":
      return "未知";
    case "failed":
      return "失败";
    case "error":
      return "错误";
    default:
      return state;
  }
}
