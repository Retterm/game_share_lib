import { useEffect, useMemo, useRef } from 'react'
import type { ConsoleTab } from './ConsoleTabs'
import { stripAnsi } from '../../lib/stripAnsi'
import { renderAnsi } from '../../lib/renderAnsi'

export type LogItem = {
  id: string
  type: 'input' | 'output' | 'error'
  level?: 'info' | 'warn' | 'error'
  text: string
  ts?: string | number | Date
}

export function ConsoleLogList({
  items,
  filter,
  search,
  showDate,
  showTime,
  autoScroll,
  className,
}: {
  items: LogItem[]
  filter: ConsoleTab
  search: string
  showDate: boolean
  showTime: boolean
  autoScroll: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const visible = useMemo(() => {
    const q = search?.trim().toLowerCase()
    return items.filter((it) => {
      const byTab = filter === 'all' ? true : it.type === filter
      const bySearch = q ? (stripAnsi(it.text).toLowerCase().includes(q)) : true
      return byTab && bySearch
    })
  }, [items, filter, search])

  useEffect(() => {
    if (!autoScroll) return
    const el = containerRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [visible, autoScroll])

  return (
    <div
      ref={containerRef}
      className={("console-scrollbar w-full min-h-0 min-w-0 rounded-md border border-[hsl(var(--tw-border))] bg-[hsl(222_28%_7%)] text-xs overflow-auto font-mono " + (className||"")) as string}
    >
      <div className="p-3 space-y-1">
        {visible.map((it) => (
          <div key={it.id} className="grid grid-cols-[auto_auto_1fr] gap-3 items-start py-0.5 px-1 rounded hover:bg-white/5 transition-colors">
            <div className="text-[11px] text-gray-400 whitespace-nowrap tabular-nums">
              {formatTs(it.ts, showDate, showTime)}
            </div>
            <div>
              <span className={chipCls(it.type)}>{typeLabel(it.type)}</span>
            </div>
            <pre className={textCls(it) + " whitespace-pre-wrap break-words break-all"}>{renderAnsi(it.text)}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

function chipCls(t: LogItem['type']) {
  if (t === 'input') return 'px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/15 text-blue-300 text-[11px]'
  if (t === 'output') return 'px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-300 text-[11px]'
  return 'px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/15 text-red-300 text-[11px]'
}

function typeLabel(t: LogItem['type']) {
  if (t === 'input') return '输入'
  if (t === 'output') return '输出'
  return '错误'
}

function textCls(it: LogItem) {
  if (it.type === 'error' || it.level === 'error') return 'text-red-400'
  if (it.level === 'warn') return 'text-yellow-300'
  return 'text-green-400'
}

function formatTs(ts: LogItem['ts'], showDate: boolean, showTime: boolean) {
  if (!showDate && !showTime) return ''
  const d = ts ? new Date(ts) : new Date()
  const date = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`
  if (showDate && showTime) return `${date}${time}`
  if (showDate) return date.trim()
  return time
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
