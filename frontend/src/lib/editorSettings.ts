import { DEFAULT_EDITOR_COLOR_THEME, isKnownEditorTheme } from './monacoEditorThemes'

const KEY = 'texpad_editor_prefs_v1'

export type KeybindingPref = 'none' | 'vim' | 'emacs'
export type PdfViewerPref = 'in_app' | 'browser'

/** 与 Overleaf「行高」下拉语义相近 */
export type EditorLineHeightPreset = 'normal' | 'compact' | 'relaxed'

export type EditorFontStackId = 'mono-default' | 'mono-cascadia' | 'mono-jetbrains' | 'mono-fira'

export const EDITOR_FONT_STACKS: Record<EditorFontStackId, string> = {
  'mono-default': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  'mono-cascadia': '"Cascadia Code", "Cascadia Mono", ui-monospace, monospace',
  'mono-jetbrains': '"JetBrains Mono", "JetBrains Mono NL", ui-monospace, monospace',
  'mono-fira': '"Fira Code", "Fira Mono", ui-monospace, monospace',
}

export const EDITOR_FONT_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: '10', label: '10px' },
  { value: '11', label: '11px' },
  { value: '12', label: '12px' },
  { value: '13', label: '13px' },
  { value: '14', label: '14px' },
  { value: '15', label: '15px' },
  { value: '16', label: '16px' },
]

export const EDITOR_FONT_FAMILY_OPTIONS: { value: EditorFontStackId; label: string }[] = [
  { value: 'mono-default', label: 'Monaco / Menlo / Consolas' },
  { value: 'mono-cascadia', label: 'Cascadia Code / Mono' },
  { value: 'mono-jetbrains', label: 'JetBrains Mono' },
  { value: 'mono-fira', label: 'Fira Code / Mono' },
]

export const EDITOR_LINE_HEIGHT_OPTIONS: { value: EditorLineHeightPreset; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'compact', label: 'Compact' },
  { value: 'relaxed', label: 'Relaxed' },
]

export type EditorPrefs = {
  autoComplete: boolean
  autoCloseBrackets: boolean
  codeCheck: boolean
  keybinding: KeybindingPref
  pdfViewer: PdfViewerPref
  referenceSearch: 'sidebar' | 'citation_panel'
  spellcheckLang: string
  customDictionary: string[]
  /** Monaco 编辑器配色主题 id（与设置中「编辑器主题」一致） */
  editorColorTheme: string
  editorFontSize: number
  editorFontStack: EditorFontStackId
  editorLineHeightPreset: EditorLineHeightPreset
}

const defaults: EditorPrefs = {
  autoComplete: true,
  autoCloseBrackets: true,
  codeCheck: true,
  keybinding: 'none',
  pdfViewer: 'in_app',
  referenceSearch: 'sidebar',
  spellcheckLang: 'en-US',
  customDictionary: [],
  editorColorTheme: DEFAULT_EDITOR_COLOR_THEME,
  editorFontSize: 14,
  editorFontStack: 'mono-default',
  editorLineHeightPreset: 'normal',
}

export function loadEditorPrefs(): EditorPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const j = JSON.parse(raw) as Partial<EditorPrefs>
    const merged = { ...defaults, ...j }
    // Monaco 主题名仅允许 [a-z0-9-]；历史版本曾使用下划线，需转成连字符
    const rawTheme = typeof merged.editorColorTheme === 'string' ? merged.editorColorTheme : ''
    const normalizedTheme = rawTheme.replace(/_/g, '-')
    const editorColorTheme = isKnownEditorTheme(normalizedTheme)
      ? normalizedTheme
      : defaults.editorColorTheme
    const rawFs = typeof merged.editorFontSize === 'number' && Number.isFinite(merged.editorFontSize) ? merged.editorFontSize : defaults.editorFontSize
    const editorFontSize = Math.min(22, Math.max(9, Math.round(rawFs)))
    const stacks = Object.keys(EDITOR_FONT_STACKS) as EditorFontStackId[]
    const editorFontStack = stacks.includes(merged.editorFontStack as EditorFontStackId)
      ? (merged.editorFontStack as EditorFontStackId)
      : defaults.editorFontStack
    const lh = merged.editorLineHeightPreset
    const editorLineHeightPreset: EditorLineHeightPreset =
      lh === 'compact' || lh === 'relaxed' || lh === 'normal' ? lh : defaults.editorLineHeightPreset
    return {
      ...merged,
      editorColorTheme,
      editorFontSize,
      editorFontStack,
      editorLineHeightPreset,
      customDictionary: Array.isArray(j.customDictionary)
        ? j.customDictionary.filter((w): w is string => typeof w === 'string')
        : defaults.customDictionary,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveEditorPrefs(p: EditorPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export function prefsToMonacoOptions(p: Pick<EditorPrefs, 'autoComplete' | 'autoCloseBrackets' | 'codeCheck'>) {
  return {
    quickSuggestions: p.autoComplete ? ({ other: true, comments: true, strings: true } as const) : false,
    suggestOnTriggerCharacters: p.autoComplete,
    wordBasedSuggestions: p.autoComplete ? ('matchingDocuments' as const) : ('off' as const),
    parameterHints: { enabled: p.autoComplete },
    autoClosingBrackets: p.autoCloseBrackets ? ('always' as const) : ('never' as const),
    autoClosingQuotes: p.autoCloseBrackets ? ('always' as const) : ('never' as const),
    autoClosingOvertype: p.autoCloseBrackets ? ('always' as const) : ('never' as const),
    renderValidationDecorations: p.codeCheck ? ('on' as const) : ('off' as const),
  }
}

function monacoLineHeightPx(fontSize: number, preset: EditorLineHeightPreset): number {
  switch (preset) {
    case 'compact':
      return Math.max(12, Math.round(fontSize * 1.22))
    case 'relaxed':
      return Math.round(fontSize * 1.72)
    default:
      return 0
  }
}

/** 字号、字体栈、行高（Monaco IEditorOptions） */
export function prefsToMonacoDisplayOptions(p: Pick<EditorPrefs, 'editorFontSize' | 'editorFontStack' | 'editorLineHeightPreset'>) {
  const fontFamily = EDITOR_FONT_STACKS[p.editorFontStack] ?? EDITOR_FONT_STACKS['mono-default']
  return {
    fontSize: p.editorFontSize,
    fontFamily,
    lineHeight: monacoLineHeightPx(p.editorFontSize, p.editorLineHeightPreset),
  }
}

export const SPELLCHECK_LANGS: { value: string; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'en-US', label: 'English (American)' },
  { value: 'en-GB', label: 'English (British)' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
]
