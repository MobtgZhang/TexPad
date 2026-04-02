import type * as monaco from 'monaco-editor'

export function insertTextAtCursor(editor: monaco.editor.IStandaloneCodeEditor, _m: typeof monaco, text: string) {
  const sel = editor.getSelection()
  if (!sel) return
  editor.executeEdits('texpad-insert', [{ range: sel, text, forceMoveMarkers: true }])
}

/** 在光标处插入并在 offset 后放置光标（相对插入文本起始） */
export function insertTextAndMoveCaret(
  editor: monaco.editor.IStandaloneCodeEditor,
  m: typeof monaco,
  text: string,
  caretOffsetInText: number,
) {
  const pos = editor.getPosition()
  if (!pos) return
  const range = new m.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
  editor.executeEdits('texpad-insert', [{ range, text, forceMoveMarkers: true }])
  const start = range.getStartPosition()
  const lines = text.slice(0, caretOffsetInText).split('\n')
  const lineDelta = lines.length - 1
  const col =
    lineDelta === 0
      ? start.column + lines[0]!.length
      : lines[lines.length - 1]!.length + 1
  editor.setPosition({ lineNumber: start.lineNumber + lineDelta, column: col })
  editor.focus()
}
