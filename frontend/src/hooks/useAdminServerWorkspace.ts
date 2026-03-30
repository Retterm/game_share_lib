import { useEffect, useState } from "react";

export interface AdminWorkspaceLoaders<TMeta, TRuntime> {
  loadMeta: () => Promise<TMeta>;
  loadRuntime?: (meta: TMeta) => Promise<TRuntime | null>;
}

export function useAdminServerWorkspace<TMeta, TRuntime>({
  serverId,
  loaders,
}: {
  serverId?: string;
  loaders: AdminWorkspaceLoaders<TMeta, TRuntime>;
}) {
  const [meta, setMeta] = useState<TMeta | null>(null);
  const [runtime, setRuntime] = useState<TRuntime | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!serverId) {
      setMeta(null);
      setRuntime(null);
      setRuntimeError(null);
      setRuntimeLoading(false);
      return;
    }

    const run = async () => {
      setRuntimeLoading(true);
      setRuntimeError(null);
      try {
        const nextMeta = await loaders.loadMeta();
        if (cancelled) return;
        setMeta(nextMeta);

        if (loaders.loadRuntime) {
          const nextRuntime = await loaders.loadRuntime(nextMeta);
          if (cancelled) return;
          setRuntime(nextRuntime);
        } else {
          setRuntime(null);
        }
      } catch (error) {
        if (cancelled) return;
        setMeta(null);
        setRuntime(null);
        setRuntimeError(error instanceof Error ? error.message : "读取运行状态失败");
      } finally {
        if (!cancelled) setRuntimeLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [serverId, loaders]);

  return {
    meta,
    runtime,
    runtimeLoading,
    runtimeError,
  };
}
