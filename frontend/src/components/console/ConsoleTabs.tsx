import { cn } from '../../lib/utils'

export type ConsoleTab = 'all' | 'input' | 'output' | 'error'

export function ConsoleTabs({ value, onChange }: { value: ConsoleTab; onChange: (t: ConsoleTab) => void }) {
  const tab = (key: ConsoleTab, label: string) => (
    <button
      key={key}
      onClick={() => onChange(key)}
      className={cn(
        'px-3 py-1.5 text-sm rounded-md border',
        value === key
          ? 'bg-blue-600/90 text-white border-blue-500'
          : 'text-[hsl(var(--tw-foreground))] border-[hsl(var(--tw-border))] hover:bg-[hsl(var(--tw-secondary))]'
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab('all', '全部')}
      {tab('input', '输入')}
      {tab('output', '输出')}
      {tab('error', '错误')}
    </div>
  )
}
