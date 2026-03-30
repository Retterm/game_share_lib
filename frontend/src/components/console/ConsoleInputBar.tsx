import { useState } from 'react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'

export function ConsoleInputBar({ onSend }: { onSend: (cmd: string) => void }) {
  const [cmd, setCmd] = useState('')
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
      <Input
        value={cmd}
        onChange={(e) => setCmd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const line = cmd.trim()
            if (line) { onSend(line); setCmd('') }
          }
        }}
        placeholder="Type a command..."
        className="min-w-0 flex-1"
      />
      <Button className="shrink-0" onClick={() => { const line = cmd.trim(); if (line) { onSend(line); setCmd('') } }}>发送</Button>
    </div>
  )
}
