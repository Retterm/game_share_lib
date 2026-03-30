import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { ConsoleTabs, ConsoleTab } from './ConsoleTabs'

export function ConsoleToolbar({
  showDate,
  showTime,
  autoScroll,
  onToggleDate,
  onToggleTime,
  onToggleAutoScroll,
  totalCount,
  visibleCount,
  search,
  onSearchChange,
  onClear,
  onScrollBottom,
  tab,
  onTabChange,
}: {
  showDate: boolean
  showTime: boolean
  autoScroll: boolean
  onToggleDate: (v: boolean) => void
  onToggleTime: (v: boolean) => void
  onToggleAutoScroll: (v: boolean) => void
  totalCount: number
  visibleCount: number
  search: string
  onSearchChange: (v: string) => void
  onClear: () => void
  onScrollBottom: () => void
  tab: ConsoleTab
  onTabChange: (t: ConsoleTab) => void
}) {
  return (
    <div className="rounded-lg border bg-[hsl(var(--tw-card))] p-3 flex min-w-0 flex-col gap-3 shadow-sm">
      <div className="flex min-w-0 flex-col gap-3 2xl:flex-row 2xl:items-center">
        <div className="text-sm font-semibold">Terminal</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 2xl:flex-nowrap">
          <div className="flex items-center gap-1.5">
            <Switch
              id="show-date"
              checked={showDate}
              onCheckedChange={onToggleDate}
            />
            <Label htmlFor="show-date" className="text-sm cursor-pointer">
              显示日期
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="show-time"
              checked={showTime}
              onCheckedChange={onToggleTime}
            />
            <Label htmlFor="show-time" className="text-sm cursor-pointer">
              显示时间
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="auto-scroll"
              checked={autoScroll}
              onCheckedChange={onToggleAutoScroll}
            />
            <Label htmlFor="auto-scroll" className="text-sm cursor-pointer">
              自动滚动
            </Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 2xl:ml-auto 2xl:flex-nowrap">
          <span className="text-xs bg-gray-800/60 text-gray-200 rounded px-2 py-1">{visibleCount}/{totalCount} 条日志</span>
          <Button size="sm" variant="outline" onClick={onScrollBottom}>滚动到底部</Button>
          <Button size="sm" variant="outline" onClick={onClear}>清空输出</Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
        <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="搜索日志内容..." className="w-full min-w-0 lg:min-w-[240px] lg:flex-1" />
        <ConsoleTabs value={tab} onChange={onTabChange} />
      </div>
    </div>
  )
}
