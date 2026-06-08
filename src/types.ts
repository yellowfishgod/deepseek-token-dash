export interface ApiKey {
  id: number;
  label: string;
  key_hash: string;
  key_prefix: string;
  color: string;
  monthly_budget: number | null;
  created_at: number;
  is_active: boolean;
}

export interface TokenUsage {
  api_key_id: number;
  label: string;
  color: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  request_count: number;
}

export interface RequestRecord {
  id: number;
  api_key_id: number;
  timestamp: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  duration_ms: number;
  endpoint: string;
}

export interface ProxyEvent {
  api_key_label: string;
  api_key_color: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  duration_ms: number;
}

export interface ModelPricing {
  model: string;
  input_price_per_1m: number;
  output_price_per_1m: number;
}

export type Page = 'dashboard' | 'settings';
export type SettingsTab = 'budget' | 'pricing' | 'keys' | 'proxy';
