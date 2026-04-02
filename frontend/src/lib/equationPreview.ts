import type * as monaco from 'monaco-editor'

/** 从光标附近提取行内 $…$ 或 \(...\) 片段，供轻量预览（非完整 TeX 渲染） */
export function extractEquationSnippet(
  model: monaco.editor.ITextModel,
  pos: monaco.Position,
): string | null {
  const line = model.getLineContent(pos.lineNumber)
  const col = pos.column - 1

  const tryDollar = (): string | null => {
    const before = line.slice(0, col)
    const after = line.slice(col)
    const open = before.lastIndexOf('$')
    if (open < 0) return null
    let close = after.indexOf('$')
    if (close < 0) {
      close = line.indexOf('$', col)
      if (close < 0 || close <= open) return null
      return line.slice(open + 1, close).trim() || null
    }
    return line.slice(open + 1, col + close).trim() || null
  }

  const tryParen = (): string | null => {
    const s = line
    const i = col
    let start = s.lastIndexOf('\\(', i)
    if (start < 0) return null
    const end = s.indexOf('\\)', start)
    if (end < 0 || end < i) return null
    return s.slice(start + 2, end).trim() || null
  }

  return tryDollar() || tryParen()
}
