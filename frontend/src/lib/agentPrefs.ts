const KEY = 'texpad_agent_prefs'

export type AgentSamplingPreset = 'precise' | 'balanced' | 'creative'

export const AGENT_SAMPLING_PRESETS: Record<
  AgentSamplingPreset,
  { label: string; temperature: number; topP: number; topK: number }
> = {
  precise: { label: '精确', temperature: 0.2, topP: 0.5, topK: 5 },
  balanced: { label: '平衡', temperature: 0.7, topP: 0.9, topK: 40 },
  creative: { label: '创新', temperature: 1, topP: 0.95, topK: 200 },
}

export type AgentPrefs = {
  llmBaseUrl: string
  llmApiKey: string
  model: string
  temperature: number
  topP: number
  topK: number
  /** -1 不限制工具轮次；0 仅对话（不调用工具）；>0 为上限 */
  agentRounds: number
}

const defaults: AgentPrefs = {
  llmBaseUrl: '',
  llmApiKey: '',
  model: '',
  temperature: 0.7,
  topP: 1,
  topK: 40,
  agentRounds: -1,
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

export function loadAgentPrefs(): AgentPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const j = JSON.parse(raw) as Partial<AgentPrefs>
    return {
      llmBaseUrl: typeof j.llmBaseUrl === 'string' ? j.llmBaseUrl : defaults.llmBaseUrl,
      llmApiKey: typeof j.llmApiKey === 'string' ? j.llmApiKey : defaults.llmApiKey,
      model: typeof j.model === 'string' ? j.model : defaults.model,
      temperature: typeof j.temperature === 'number' && Number.isFinite(j.temperature) ? clamp(j.temperature, 0, 2) : defaults.temperature,
      topP: typeof j.topP === 'number' && Number.isFinite(j.topP) ? clamp(j.topP, 0, 1) : defaults.topP,
      topK: typeof j.topK === 'number' && Number.isFinite(j.topK) ? clamp(Math.round(j.topK), 0, 200) : defaults.topK,
      agentRounds:
        typeof j.agentRounds === 'number' && Number.isFinite(j.agentRounds) ? clamp(Math.round(j.agentRounds), -1, 100) : defaults.agentRounds,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveAgentPrefs(p: AgentPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export function applyAgentSamplingPreset(p: AgentPrefs, preset: AgentSamplingPreset): AgentPrefs {
  const s = AGENT_SAMPLING_PRESETS[preset]
  return { ...p, temperature: s.temperature, topP: s.topP, topK: s.topK }
}

export function matchAgentSamplingPreset(p: AgentPrefs): AgentSamplingPreset | null {
  for (const key of Object.keys(AGENT_SAMPLING_PRESETS) as AgentSamplingPreset[]) {
    const s = AGENT_SAMPLING_PRESETS[key]
    if (
      Math.abs(p.temperature - s.temperature) < 1e-6 &&
      Math.abs(p.topP - s.topP) < 1e-6 &&
      p.topK === s.topK
    ) {
      return key
    }
  }
  return null
}

/** Body fragment merged into agent stream POST JSON */
export function agentPrefsToStreamFields(p: AgentPrefs): Record<string, unknown> {
  const out: Record<string, unknown> = {
    max_tool_steps: p.agentRounds,
  }
  if (p.llmBaseUrl.trim()) out.llm_base_url = p.llmBaseUrl.trim()
  if (p.llmApiKey.trim()) out.llm_api_key = p.llmApiKey.trim()
  if (p.model.trim()) out.model = p.model.trim()
  out.temperature = p.temperature
  out.top_p = p.topP
  if (p.topK > 0) out.top_k = p.topK
  return out
}
