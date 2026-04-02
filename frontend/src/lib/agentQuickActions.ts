import type { AgentQuickAction } from '../components/editor/EditorAgentPanel'

const MAX_SNIP = 16000

function firstSectionTitle(tex: string): string | undefined {
  const m = /\\(?:section|subsection|chapter)\*?\{([^}]*)\}/.exec(tex)
  if (!m?.[1]) return undefined
  const s = m[1].trim()
  return s.slice(0, 72) || undefined
}

function firstEnv(tex: string, env: string): boolean {
  return new RegExp(`\\\\begin\\s*\\{\\s*${env}\\s*\\}`, 'i').test(tex)
}

/** 根据当前打开文件路径与编辑器内 LaTeX 片段生成 4 条快捷提问（无需调用远程 API）。 */
export function buildAgentQuickActions(activePath: string, source: string): AgentQuickAction[] {
  const path = activePath.trim() || '当前打开的文件'
  const t = source.slice(0, MAX_SNIP)
  const lower = t.toLowerCase()
  const sec = firstSectionTitle(t)
  const seen = new Set<string>()
  const out: AgentQuickAction[] = []

  const push = (label: string, fill: string) => {
    if (out.length >= 4 || seen.has(label)) return
    seen.add(label)
    out.push({ label, fill })
  }

  push(
    '结合当前文稿可以做什么？',
    `我当前正在编辑「${path}」。请根据你在项目里能读到的内容，简要说明你能帮我做哪些事（改写、查错、结构、参考文献等），并说明使用工具时的注意点。`,
  )

  if (/\\documentclass\s*\{[^}]*beamer/i.test(t) || lower.includes('beamer')) {
    push(
      '优化 Beamer 结构与讲稿',
      `文件「${path}」与 Beamer 相关。请根据现有帧与章节结构，建议叙事节奏、每页信息密度，并提醒常见的主题/编译选项问题。`,
    )
  }

  if (firstEnv(t, 'figure') || /\\includegraphics\b/i.test(t)) {
    push(
      '检查插图与浮动体',
      `请针对「${path}」中的 figure / includegraphics，检查路径、宽度选项与浮动体参数是否合理，并给出最小修改建议。`,
    )
  }

  if (/\\cite\b/i.test(t) || /\\bibliography\b/i.test(t) || /\.bib\b/i.test(t)) {
    push(
      '核对引用与参考文献',
      `请结合「${path}」中的 \\cite、\\bibliography 等，说明如何检查未定义引用、bst/bib 一致性，以及建议的排查顺序。`,
    )
  }

  if (
    /\\begin\s*\{\s*equation/i.test(t) ||
    /\\begin\s*\{\s*align/i.test(t) ||
    /\\\(|\\\[/i.test(t) ||
    lower.includes('amsmath')
  ) {
    push(
      '审阅公式与数学排版',
      `请查看「${path}」中的数学环境，指出可能的编号、对齐、间距或 amsmath 使用问题，并给出改写示例（如需要）。`,
    )
  }

  if (lower.includes('tikz') || /\\begin\s*\{\s*tikzpicture/i.test(t)) {
    push(
      '梳理 TikZ 代码结构',
      `请针对「${path}」中的 TikZ 片段，从可读性、可维护性和编译风险给建议（如样式抽取、坐标系选择）。`,
    )
  }

  if (sec) {
    push(
      `改进「${sec.length > 28 ? `${sec.slice(0, 28)}…` : sec}」一节`,
      `请重点针对「${path}」里标题含「${sec}」的小节，从逻辑衔接与表述上给出可执行的修改建议（可分步）。`,
    )
  }

  const pads: AgentQuickAction[] = [
    {
      label: '检查常见 LaTeX 风险',
      fill: `请通读「${path}」中可见内容，列出包冲突、未定义引用、特殊字符转义、图片路径等常见风险，并给出建议的排查顺序。`,
    },
    {
      label: '收紧摘要或引言',
      fill: `若「${path}」中有 abstract、introduction 或中文摘要/引言，请建议如何删冗、突出问题陈述与贡献，并标出可合并的句子类型。`,
    },
    {
      label: '统一术语与记号',
      fill: `请根据「${path}」全文可见部分，指出术语或数学记号不一致之处，并给出统一表或修改建议（不必一次改完）。`,
    },
    {
      label: '补全编译主链',
      fill: `请根据「${path}」判断主文档与子文件关系，说明应如何组织 \\input/\\include、主 tex 与参考文献编译顺序，避免循环依赖。`,
    },
  ]

  for (const p of pads) {
    push(p.label, p.fill)
    if (out.length >= 4) break
  }

  return out
}

/** 将后端或网络层的原始错误串转为面向用户的「无法使用 API」类提示 */
export function humanizeAgentErrorMessage(raw: string): string {
  const s = raw.trim()
  const low = s.toLowerCase()
  if (!s) return '无法使用 API。'
  if (s.includes('无法使用 API')) return s
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(low)) {
    return '无法使用 API（网络异常）。请检查网络或后端是否可达。'
  }
  if (s === '请求失败') return '无法使用 API。'
  if (/llm http\s*\d{3}/i.test(s) || /^stream\s*\d{3}/i.test(s)) {
    if (/\b404\b/.test(s)) {
      return '无法使用 API（远端返回 404）。请核对「设置 → 智能体」中的 API 基础地址、密钥与模型 ID。'
    }
    if (/\b401\b|\b403\b/.test(s)) return '无法使用 API（鉴权失败）。请检查 API 密钥。'
    if (/\b429\b/.test(s)) return '无法使用 API（请求过于频繁）。请稍后再试。'
    if (/\b5\d\d\b/.test(s)) return '无法使用 API（上游暂不可用）。请稍后再试。'
    return '无法使用 API。请在「设置 → 智能体」中检查 API 基础地址、密钥与模型。'
  }
  return s
}

export function humanizeAgentHttpStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return '无法使用 API（未授权）。请重新登录或检查权限。'
  if (status === 404) return '无法使用 API（请求未找到）。请确认后端已部署且路由正确。'
  if (status >= 500) return '无法使用 API（服务异常）。请稍后再试。'
  const t = body.trim().slice(0, 240)
  return t ? `无法使用 API。（${t}）` : '无法使用 API。'
}
