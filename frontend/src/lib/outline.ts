/** LaTeX section outline: line numbers are 1-based. */
export type OutlineSection = { line: number; level: number; title: string }

const RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{([^}]*)\}/

export function parseTexOutline(text: string): OutlineSection[] {
  const lines = text.split('\n')
  const levelMap: Record<string, number> = {
    part: 0,
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
  }
  const out: OutlineSection[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = RE.exec(lines[i]!)
    if (!m) continue
    const cmd = m[1]!
    const title = m[2]!.trim()
    const level = levelMap[cmd] ?? 2
    out.push({ line: i + 1, level, title })
  }
  return out
}

/** Index of last section at or before `line` (1-based), or -1 */
export function outlineIndexForLine(sections: OutlineSection[], line: number): number {
  let best = -1
  for (let i = 0; i < sections.length; i++) {
    if (sections[i]!.line <= line) best = i
    else break
  }
  return best
}
