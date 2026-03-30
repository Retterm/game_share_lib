import React from 'react'

type StyleState = {
  color?: string
  backgroundColor?: string
  fontWeight?: 'normal' | 'bold'
}

const FG: Record<number, string> = {
  30: '#000000',
  31: '#cc0000',
  32: '#4e9a06',
  33: '#c4a000',
  34: '#3465a4',
  35: '#75507b',
  36: '#06989a',
  37: '#d3d7cf',
  90: '#555753',
  91: '#ef2929',
  92: '#8ae234',
  93: '#fce94f',
  94: '#729fcf',
  95: '#ad7fa8',
  96: '#34e2e2',
  97: '#eeeeec',
}

const BG: Record<number, string> = {
  40: '#000000',
  41: '#cc0000',
  42: '#4e9a06',
  43: '#c4a000',
  44: '#3465a4',
  45: '#75507b',
  46: '#06989a',
  47: '#d3d7cf',
  100: '#555753',
  101: '#ef2929',
  102: '#8ae234',
  103: '#fce94f',
  104: '#729fcf',
  105: '#ad7fa8',
  106: '#34e2e2',
  107: '#eeeeec',
}

function reset(): StyleState {
  return { fontWeight: 'normal' }
}

function applySgrCodes(prev: StyleState, codes: number[]): StyleState {
  let s: StyleState = { ...prev }
  if (codes.length === 0) codes = [0]

  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) {
      s = reset()
      continue
    }
    if (c === 1) {
      s.fontWeight = 'bold'
      continue
    }
    if (c === 22) {
      s.fontWeight = 'normal'
      continue
    }
    if (c === 39) {
      delete s.color
      continue
    }
    if (c === 49) {
      delete s.backgroundColor
      continue
    }
    if (typeof FG[c] === 'string') {
      s.color = FG[c]
      continue
    }
    if (typeof BG[c] === 'string') {
      s.backgroundColor = BG[c]
      continue
    }
    if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      const r = codes[i + 2]
      const g = codes[i + 3]
      const b = codes[i + 4]
      if ([r, g, b].every((x) => Number.isFinite(x))) {
        const rgb = `rgb(${r}, ${g}, ${b})`
        if (c === 38) s.color = rgb
        else s.backgroundColor = rgb
      }
      i += 4
      continue
    }
    if ((c === 38 || c === 48) && codes[i + 1] === 5) {
      i += 2
      continue
    }
  }
  return s
}

export function renderAnsi(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let style: StyleState = reset()
  const re = /\u001b\[([0-9;?]*)m/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  let seg = 0

  while ((m = re.exec(text)) !== null) {
    const idx = m.index
    if (idx > lastIdx) {
      const chunk = text.slice(lastIdx, idx)
      out.push(
        <span key={`t-${seg++}`} style={style}>
          {chunk}
        </span>
      )
    }
    const raw = m[1] || ''
    const codes = raw
      .split(';')
      .filter((x) => x.length > 0 && x !== '?')
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n))
    style = applySgrCodes(style, codes)
    lastIdx = re.lastIndex
  }

  if (lastIdx < text.length) {
    out.push(
      <span key={`t-${seg++}`} style={style}>
        {text.slice(lastIdx)}
      </span>
    )
  }

  return out
}
