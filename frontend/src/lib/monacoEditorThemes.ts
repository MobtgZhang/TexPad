import type * as monaco from 'monaco-editor'

/**
 * 与 Overleaf（Ace）名称对齐的编辑器配色；基于 Monaco defineTheme，针对 LaTeX 词法高亮做了规则覆盖。
 * 主题 id 必须符合 Monaco 校验：/^[a-z0-9-]+$/i（不可含下划线等），否则会抛 Illegal theme name!
 */
export type MonacoEditorThemeOption = { id: string; label: string }

const latexRulesLight: monaco.editor.ITokenThemeRule[] = [
  { token: 'keyword', foreground: '0451a5', fontStyle: 'bold' },
  { token: 'delimiter.bracket', foreground: '0431fa' },
  { token: 'string', foreground: 'a31515' },
  { token: 'comment', foreground: '008000', fontStyle: 'italic' },
]

const latexRulesDark: monaco.editor.ITokenThemeRule[] = [
  { token: 'keyword', foreground: 'c586c0', fontStyle: 'bold' },
  { token: 'delimiter.bracket', foreground: '569cd6' },
  { token: 'string', foreground: 'ce9178' },
  { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
]

type Spec = {
  id: string
  label: string
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  colors: Record<string, string>
}

/** 顺序与 Overleaf 主题下拉相近；id 以 texpad-ace- 为前缀 */
const SPECS: Spec[] = [
  {
    id: 'texpad-latex-light',
    label: 'Overleaf light',
    base: 'vs',
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1a1a1a',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#24292f',
      'editor.lineHighlightBackground': '#e8f4fc',
      'editorCursor.foreground': '#24292f',
      'editor.selectionBackground': '#add6ff',
      'editor.inactiveSelectionBackground': '#e5ebf1',
    },
  },
  { id: 'texpad-ace-textmate', label: 'TextMate', base: 'vs', colors: {} },
  { id: 'texpad-ace-chrome', label: 'Chrome', base: 'vs', colors: { 'editor.background': '#ffffff' } },
  { id: 'texpad-ace-clouds', label: 'Clouds', base: 'vs', colors: { 'editor.background': '#ffffff', 'editor.foreground': '#000000' } },
  {
    id: 'texpad-ace-crimson-editor',
    label: 'Crimson Editor',
    base: 'vs',
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#333333', 'editor.lineHighlightBackground': '#efefef' },
  },
  { id: 'texpad-ace-dawn', label: 'Dawn', base: 'vs', colors: { 'editor.background': '#f9f9f9', 'editor.foreground': '#080808' } },
  {
    id: 'texpad-ace-dreamweaver',
    label: 'Dreamweaver',
    base: 'vs',
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#000000' },
  },
  { id: 'texpad-ace-eclipse', label: 'Eclipse', base: 'vs', colors: { 'editor.background': '#ffffff', 'editor.foreground': '#333333' } },
  { id: 'texpad-ace-github', label: 'GitHub', base: 'vs', colors: { 'editor.background': '#f8f8ff', 'editor.foreground': '#333333' } },
  {
    id: 'texpad-ace-iplastic',
    label: 'IPlastic',
    base: 'vs',
    colors: { 'editor.background': '#eeeeee', 'editor.foreground': '#333333' },
  },
  {
    id: 'texpad-ace-katzenmilch',
    label: 'Katzenmilch',
    base: 'vs',
    colors: { 'editor.background': '#f3f2f3', 'editor.foreground': '#333333' },
  },
  {
    id: 'texpad-ace-kuroir',
    label: 'Kuroir',
    base: 'vs',
    colors: { 'editor.background': '#e8e8e8', 'editor.foreground': '#333333' },
  },
  {
    id: 'texpad-ace-solarized-light',
    label: 'Solarized Light',
    base: 'vs',
    colors: {
      'editor.background': '#fdf6e3',
      'editor.foreground': '#657b83',
      'editorLineNumber.foreground': '#93a1a1',
      'editorLineNumber.activeForeground': '#586e75',
      'editor.lineHighlightBackground': '#eee8d5',
      'editorCursor.foreground': '#657b83',
      'editor.selectionBackground': '#eee8d5',
    },
  },
  {
    id: 'texpad-ace-sqlserver',
    label: 'SQL Server',
    base: 'vs',
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#333333' },
  },
  { id: 'texpad-ace-idle-fingers', label: 'Idle Fingers', base: 'vs-dark', colors: { 'editor.background': '#323232', 'editor.foreground': '#ffffff' } },
  {
    id: 'texpad-ace-ambiance',
    label: 'Ambiance',
    base: 'vs-dark',
    colors: { 'editor.background': '#202020', 'editor.foreground': '#e6e1dc', 'editor.lineHighlightBackground': '#333333' },
  },
  {
    id: 'texpad-ace-chaos',
    label: 'Chaos',
    base: 'vs-dark',
    colors: { 'editor.background': '#161616', 'editor.foreground': '#e6e1dc' },
  },
  {
    id: 'texpad-ace-clouds-midnight',
    label: 'Clouds Midnight',
    base: 'vs-dark',
    colors: { 'editor.background': '#191919', 'editor.foreground': '#929292' },
  },
  {
    id: 'texpad-ace-cobalt',
    label: 'Cobalt',
    base: 'vs-dark',
    colors: { 'editor.background': '#002240', 'editor.foreground': '#ffffff', 'editor.lineHighlightBackground': '#004c7e' },
  },
  {
    id: 'texpad-ace-kr-theme',
    label: 'krTheme',
    base: 'vs-dark',
    colors: { 'editor.background': '#0b0a09', 'editor.foreground': '#fcffe0' },
  },
  {
    id: 'texpad-ace-merbivore',
    label: 'Merbivore',
    base: 'vs-dark',
    colors: { 'editor.background': '#161616', 'editor.foreground': '#e6e6e6' },
  },
  {
    id: 'texpad-ace-merbivore-soft',
    label: 'Merbivore Soft',
    base: 'vs-dark',
    colors: { 'editor.background': '#1c1c1c', 'editor.foreground': '#e6e6e6' },
  },
  {
    id: 'texpad-ace-mono-industrial',
    label: 'Mono Industrial',
    base: 'vs-dark',
    colors: { 'editor.background': '#222c28', 'editor.foreground': '#c5c8c6' },
  },
  {
    id: 'texpad-ace-monokai',
    label: 'Monokai',
    base: 'vs-dark',
    colors: {
      'editor.background': '#272822',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#90908a',
      'editor.lineHighlightBackground': '#3e3d32',
      'editor.selectionBackground': '#49483e',
    },
  },
  {
    id: 'texpad-ace-pastel-on-dark',
    label: 'Pastel on dark',
    base: 'vs-dark',
    colors: { 'editor.background': '#2c2828', 'editor.foreground': '#8f938f' },
  },
  {
    id: 'texpad-ace-solarized-dark',
    label: 'Solarized Dark',
    base: 'vs-dark',
    colors: {
      'editor.background': '#002b36',
      'editor.foreground': '#839496',
      'editorLineNumber.foreground': '#586e75',
      'editorLineNumber.activeForeground': '#93a1a1',
      'editor.lineHighlightBackground': '#073642',
      'editor.selectionBackground': '#073642',
    },
  },
  {
    id: 'texpad-ace-terminal',
    label: 'Terminal',
    base: 'vs-dark',
    colors: { 'editor.background': '#000000', 'editor.foreground': '#dedede' },
  },
  {
    id: 'texpad-ace-tomorrow-night',
    label: 'Tomorrow Night',
    base: 'vs-dark',
    colors: {
      'editor.background': '#1d1f21',
      'editor.foreground': '#c5c8c6',
      'editor.lineHighlightBackground': '#282a2e',
      'editor.selectionBackground': '#373b41',
    },
  },
  {
    id: 'texpad-ace-tomorrow-night-blue',
    label: 'Tomorrow Night Blue',
    base: 'vs-dark',
    colors: { 'editor.background': '#002451', 'editor.foreground': '#ffffff' },
  },
  {
    id: 'texpad-ace-tomorrow-night-bright',
    label: 'Tomorrow Night Bright',
    base: 'vs-dark',
    colors: { 'editor.background': '#000000', 'editor.foreground': '#dedede' },
  },
  {
    id: 'texpad-ace-tomorrow-night-eighties',
    label: 'Tomorrow Night 80s',
    base: 'vs-dark',
    colors: { 'editor.background': '#2d2d2d', 'editor.foreground': '#cccccc' },
  },
  {
    id: 'texpad-ace-twilight',
    label: 'Twilight',
    base: 'vs-dark',
    colors: { 'editor.background': '#141414', 'editor.foreground': '#f8f8f8' },
  },
  {
    id: 'texpad-ace-vibrant-ink',
    label: 'Vibrant Ink',
    base: 'vs-dark',
    colors: { 'editor.background': '#0f0f0f', 'editor.foreground': '#ffffff' },
  },
  { id: 'vs', label: 'VS (Light)', base: 'vs', colors: {} },
  { id: 'vs-dark', label: 'VS Dark', base: 'vs-dark', colors: {} },
  { id: 'hc-black', label: 'High Contrast Dark', base: 'hc-black', colors: {} },
  { id: 'hc-light', label: 'High Contrast Light', base: 'hc-light', colors: {} },
]

export const MONACO_EDITOR_THEME_OPTIONS: MonacoEditorThemeOption[] = SPECS.map((s) => ({ id: s.id, label: s.label }))

export const DEFAULT_EDITOR_COLOR_THEME = 'texpad-latex-light'

const KNOWN_IDS = new Set(SPECS.map((s) => s.id))

export function isKnownEditorTheme(id: string): boolean {
  return KNOWN_IDS.has(id)
}

/** 与 Monaco 内置主题 id 同名时不得 defineTheme 覆盖，否则易导致编辑器二次挂载或切主题后画布异常（整页发黑/空白）。 */
const MONACO_BUILTIN_THEME_IDS = new Set(['vs', 'vs-dark', 'hc-black', 'hc-light'])

export function registerMonacoLatexEditorThemes(m: typeof monaco) {
  for (const spec of SPECS) {
    if (MONACO_BUILTIN_THEME_IDS.has(spec.id)) {
      continue
    }
    const lightBase = spec.base === 'vs' || spec.base === 'hc-light'
    const rules = lightBase ? latexRulesLight : latexRulesDark
    m.editor.defineTheme(spec.id, {
      base: spec.base,
      inherit: true,
      rules,
      colors: spec.colors,
    })
  }
}
