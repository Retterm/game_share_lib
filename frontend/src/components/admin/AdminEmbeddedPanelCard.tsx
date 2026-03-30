import type { ReactNode } from "react";
import { PanelSurface } from "../page/PanelSurface";

interface AdminEmbeddedPanelCardProps {
  title: string;
  description: string;
  canEmbed: boolean;
  children: ReactNode;
  fallback: ReactNode;
}

export function AdminEmbeddedPanelCard({
  title,
  description,
  canEmbed,
  children,
  fallback,
}: AdminEmbeddedPanelCardProps) {
  return (
    <PanelSurface className="bg-[hsl(var(--tw-background))]">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="h-[920px] min-h-0 overflow-hidden">{canEmbed ? children : fallback}</div>
    </PanelSurface>
  );
}
