package agent

import "strings"

// LLMOverrides optional per-request settings from the client (merged with server env).
type LLMOverrides struct {
	BaseURL      string   `json:"llm_base_url"`
	APIKey       string   `json:"llm_api_key"`
	Model        string   `json:"model"`
	Temperature  *float64 `json:"temperature"`
	TopP         *float64 `json:"top_p"`
	TopK         *float64 `json:"top_k"`
	MaxToolSteps *int     `json:"max_tool_steps"`
}

type llmRuntime struct {
	baseURL   string
	apiKey    string
	model     string
	tempChat  float64
	tempThink float64
	topP      *float64
	topK      *float64
}

// LLMConfigured 是否具备可调用 LLM（环境变量或 o 中的覆盖）。
func (s *Service) LLMConfigured(o *LLMOverrides) bool {
	_, ok := s.resolveLLM(o)
	return ok
}

func (s *Service) resolveLLM(o *LLMOverrides) (llmRuntime, bool) {
	r := llmRuntime{
		baseURL:   strings.TrimRight(s.cfg.LLMBaseURL, "/"),
		apiKey:    s.cfg.LLMAPIKey,
		model:     s.cfg.LLMModel,
		tempChat:  0.2,
		tempThink: 0.35,
	}
	if o != nil {
		if t := strings.TrimSpace(o.BaseURL); t != "" {
			r.baseURL = strings.TrimRight(t, "/")
		}
		if t := strings.TrimSpace(o.APIKey); t != "" {
			r.apiKey = t
		}
		if t := strings.TrimSpace(o.Model); t != "" {
			r.model = t
		}
		if o.Temperature != nil {
			r.tempChat = *o.Temperature
			r.tempThink = *o.Temperature
		}
		if o.TopP != nil {
			r.topP = o.TopP
		}
		if o.TopK != nil {
			r.topK = o.TopK
		}
	}
	if r.baseURL == "" || r.apiKey == "" {
		return r, false
	}
	return r, true
}

func applySampling(rt llmRuntime, body map[string]any) {
	if rt.topP != nil {
		body["top_p"] = *rt.topP
	}
	if rt.topK != nil {
		body["top_k"] = int(*rt.topK)
	}
}
