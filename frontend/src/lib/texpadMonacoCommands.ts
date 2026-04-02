import type * as monaco from 'monaco-editor'

/** 供 registerTexPadMonacoCommands 的 getCtx() 返回；建议在宿主组件每帧写入 ref.current */
export type TexPadCommandCtx = {
  openFind: () => void
  compile: () => void | Promise<void>
  openCommentsPanel: () => void
  saveAndCompile: () => void | Promise<void>
  trackChangesStub: () => void
}

export function transformSelection(editor: monaco.editor.IStandaloneCodeEditor, map: (s: string) => string) {
  const model = editor.getModel()
  const sel = editor.getSelection()
  if (!model || !sel) return
  const text = model.getValueInRange(sel)
  const next = map(text)
  if (next === text) return
  editor.executeEdits('texpad-transform', [{ range: sel, text: next, forceMoveMarkers: true }])
}

export function wrapSelection(editor: monaco.editor.IStandaloneCodeEditor, _m: typeof monaco, before: string, after: string) {
  const model = editor.getModel()
  const sel = editor.getSelection()
  if (!model || !sel) return
  const text = model.getValueInRange(sel)
  editor.executeEdits('texpad-wrap', [{ range: sel, text: `${before}${text}${after}`, forceMoveMarkers: true }])
}

export function moveCursorDocumentStart(editor: monaco.editor.IStandaloneCodeEditor, m: typeof monaco) {
  const model = editor.getModel()
  if (!model) return
  const pos = new m.Position(1, 1)
  editor.setPosition(pos)
  editor.revealLineInCenter(1)
}

export function moveCursorDocumentEnd(editor: monaco.editor.IStandaloneCodeEditor, m: typeof monaco) {
  const model = editor.getModel()
  if (!model) return
  const line = model.getLineCount()
  const col = model.getLineMaxColumn(line)
  const pos = new m.Position(line, col)
  editor.setPosition(pos)
  editor.revealLineInCenter(line)
}

export function toggleLatexLineComment(editor: monaco.editor.IStandaloneCodeEditor, m: typeof monaco) {
  const model = editor.getModel()
  if (!model) return
  const sel = editor.getSelection()
  if (!sel) return
  const start = sel.startLineNumber
  const end = sel.endLineNumber
  const edits: { range: monaco.Range; text: string; forceMoveMarkers: boolean }[] = []
  for (let ln = start; ln <= end; ln++) {
    const line = model.getLineContent(ln)
    const maxCol = Math.max(1, line.length + 1)
    const range = new m.Range(ln, 1, ln, maxCol)
    const lead = /^\s*/
    const mLead = lead.exec(line)
    const indent = mLead ? mLead[0] : ''
    const rest = line.slice(indent.length)
    if (/^%\s?/.test(rest)) {
      const stripped = rest.replace(/^%\s?/, '')
      edits.push({ range, text: indent + stripped, forceMoveMarkers: true })
    } else {
      edits.push({ range, text: `${indent}% ${rest}`, forceMoveMarkers: true })
    }
  }
  editor.executeEdits('texpad-latex-comment', edits)
}

/** Register TexPad shortcuts; call once per editor instance. */
export function registerTexPadMonacoCommands(
  editor: monaco.editor.IStandaloneCodeEditor,
  m: typeof monaco,
  getCtx: () => TexPadCommandCtx,
): void {
  const K = m.KeyMod
  const C = m.KeyCode

  const add = (keybinding: number, run: () => void) => {
    editor.addCommand(keybinding, run)
  }

  add(K.CtrlCmd | C.KeyF, () => getCtx().openFind())
  add(K.CtrlCmd | C.KeyS, () => void getCtx().saveAndCompile())
  add(K.CtrlCmd | C.Enter, () => void getCtx().compile())
  add(K.CtrlCmd | C.Home, () => moveCursorDocumentStart(editor, m))
  add(K.CtrlCmd | C.End, () => moveCursorDocumentEnd(editor, m))
  add(K.CtrlCmd | K.Shift | C.KeyL, () => editor.getAction('editor.action.gotoLine')?.run())
  add(K.CtrlCmd | C.Slash, () => {
    const lang = editor.getModel()?.getLanguageId()
    if (lang === 'latex') toggleLatexLineComment(editor, m)
    else editor.getAction('editor.action.commentLine')?.run()
  })
  add(K.CtrlCmd | C.KeyU, () => transformSelection(editor, (s) => s.toUpperCase()))
  add(K.CtrlCmd | K.Shift | C.KeyU, () => transformSelection(editor, (s) => s.toLowerCase()))
  add(K.CtrlCmd | C.KeyB, () => wrapSelection(editor, m, '\\textbf{', '}'))
  add(K.CtrlCmd | C.KeyI, () => wrapSelection(editor, m, '\\textit{', '}'))
  add(K.CtrlCmd | C.KeyD, () => editor.getAction('editor.action.deleteLines')?.run())
  add(K.CtrlCmd | C.Space, () => editor.getAction('editor.action.triggerSuggest')?.run())
  add(K.CtrlCmd | C.KeyY, () => editor.getAction('editor.action.redo')?.run())
  add(K.CtrlCmd | C.KeyJ, () => getCtx().openCommentsPanel())
  add(K.CtrlCmd | K.Shift | C.KeyC, () => getCtx().openCommentsPanel())
  add(K.CtrlCmd | K.Shift | C.KeyA, () => getCtx().trackChangesStub())
}
