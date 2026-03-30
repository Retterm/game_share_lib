import { useEffect, useState } from "react";

import { PanelScaffold } from "../components/page/PanelScaffold";
import { PanelSurface } from "../components/page/PanelSurface";
import { Alert } from "../components/ui/alert";
import { useGrafanaPublicDashboard } from "../hooks";

export function SharedMetricsPage() {
  const { url, error, loading, setLoading } = useGrafanaPublicDashboard();
  const [iframeLoading, setIframeLoading] = useState(false);

  useEffect(() => {
    setIframeLoading(Boolean(url) || loading);
  }, [loading, url]);

  return (
    <PanelScaffold>
      <PanelSurface>
        {url ? (
        <div className="relative min-h-[600px] w-full flex-1 overflow-hidden">
          {iframeLoading ? (
            <div className="absolute inset-0 p-4">
              <div className="h-full w-full animate-pulse rounded-md bg-black/20" />
              <div className="mt-3 text-xs text-muted-foreground">Grafana 面板加载中…</div>
            </div>
          ) : null}
          <iframe
            src={url}
            className="h-full min-h-[600px] w-full"
            onLoad={() => {
              setIframeLoading(false);
              setLoading(false);
            }}
          />
        </div>
      ) : (
        <Alert>
          <div className="text-muted-foreground">
            {error ? "面板加载失败，请稍后重试。" : "面板正在准备中，请稍后刷新重试。"}
          </div>
        </Alert>
      )}
      </PanelSurface>
    </PanelScaffold>
  );
}
