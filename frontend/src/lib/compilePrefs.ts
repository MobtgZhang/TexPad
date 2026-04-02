const KEY = 'texpad_compile_prefs_v1'

export type CompileMode = 'normal' | 'draft'
export type CompilePrefs = {
  compileMode: CompileMode
  syntaxCheckBeforeCompile: boolean
  haltOnFirstError: boolean
  /** 编辑后自动触发编译（防抖；主文档由项目设置决定） */
  autoCompile: boolean
  /** 与 Overleaf 类似的版本标注；实际环境取决于部署的 TeX Live 镜像 */
  texLiveLabel: string
}

const defaults: CompilePrefs = {
  compileMode: 'normal',
  syntaxCheckBeforeCompile: false,
  haltOnFirstError: true,
  autoCompile: false,
  texLiveLabel: '2025',
}

export function loadCompilePrefs(): CompilePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const j = JSON.parse(raw) as Partial<CompilePrefs>
    const allowedTex = new Set(['2025', '2024'])
    const tex =
      typeof j.texLiveLabel === 'string' && allowedTex.has(j.texLiveLabel) ? j.texLiveLabel : defaults.texLiveLabel
    return {
      ...defaults,
      compileMode: j.compileMode === 'draft' ? 'draft' : 'normal',
      syntaxCheckBeforeCompile: typeof j.syntaxCheckBeforeCompile === 'boolean' ? j.syntaxCheckBeforeCompile : defaults.syntaxCheckBeforeCompile,
      haltOnFirstError: typeof j.haltOnFirstError === 'boolean' ? j.haltOnFirstError : defaults.haltOnFirstError,
      autoCompile: typeof j.autoCompile === 'boolean' ? j.autoCompile : defaults.autoCompile,
      texLiveLabel: tex,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveCompilePrefs(p: CompilePrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}
