export interface LLMResponse {
  summary: string;
  error?: string;
  fromCache?: boolean;
  cachedAt?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptConfig {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface CustomPrompts {
  chinese: PromptConfig;
  english: PromptConfig;
}

export type Language = 'chinese' | 'english';
export type APIProvider = 'claude' | 'openai' | 'openrouter' | 'portkey';

export interface ChatRequest {
  messages: ChatMessage[];
  provider: APIProvider;
  modelIdentifier?: string;
  apiKey: string;
  apiUrl?: string;
  virtualKey?: string;
  language?: Language;
  customPrompts?: CustomPrompts;
  // Optional fields for caching and other features
  url?: string;
  forceFresh?: boolean;
  tabId?: number;
}

export interface APIConfig {
  apiKey: string;
  apiUrl?: string;
  virtualKey?: string;
  modelIdentifier?: string;
  language?: Language;
  customPrompts?: CustomPrompts;
}

// Common interface for all API providers
export interface APIProviderInterface {
  // Initialize the API with configuration
  initialize(config: APIConfig): void;

  // Main API methods - no longer need to pass config params
  callAPI(
    messagesOrText: ChatMessage[] | string,
    language?: Language,
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse>;

  callLargeContextAPI?(
    messages: ChatMessage[],
    language?: Language,
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse>;
}

// Abstract base class for API providers
export abstract class BaseAPIProvider implements APIProviderInterface {
  protected config: APIConfig | null = null;

  initialize(config: APIConfig): void {
    this.config = config;
  }

  protected validateConfig(): void {
    if (!this.config) {
      throw new Error('API provider not initialized. Call initialize() first.');
    }
    if (!this.config.apiKey) {
      throw new Error('API key is required');
    }
  }

  abstract callAPI(
    messagesOrText: ChatMessage[] | string,
    language?: Language,
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse>;
}

// Default prompt configurations
export const DEFAULT_PROMPTS: Record<Language, PromptConfig> = {
  chinese: {
    systemPrompt: '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。',
    userPrompt: '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}',
    temperature: 0.5,
    maxTokens: 1000
  },
  english: {
    systemPrompt: 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.',
    userPrompt: 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}',
    temperature: 0.5,
    maxTokens: 1000
  }
};

// Model identifiers for each provider
export const DEFAULT_MODEL_IDENTIFIERS: Record<APIProvider, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4',
  openrouter: 'openai/gpt-4', // OpenRouter uses provider/model format
  portkey: 'gpt-4'
};

// Helper functions
export function getPromptConfig(language: Language, customPrompts?: CustomPrompts): PromptConfig {
  if (customPrompts && customPrompts[language]) {
    return customPrompts[language];
  }
  return DEFAULT_PROMPTS[language];
}

export function createPrompt(text: string, language: Language, customPrompts?: CustomPrompts): string {
  const promptConfig = getPromptConfig(language, customPrompts);
  return promptConfig.userPrompt.replace('{text}', text);
}

export function getModelIdentifier(provider: APIProvider, modelIdentifier?: string): string {
  return modelIdentifier || DEFAULT_MODEL_IDENTIFIERS[provider];
}

// Convert a text string to ChatMessage format for summarization
export function textToChatMessages(text: string, language: Language = 'chinese', customPrompts?: CustomPrompts): ChatMessage[] {
  const userPrompt = createPrompt(text, language, customPrompts);

  return [
    {
      role: 'user',
      content: userPrompt
    }
  ];
}

// Check if messages are for text summarization (single user message)
export function isTextSummarization(messages: ChatMessage[]): boolean {
  return messages.length === 1 && messages[0].role === 'user';
}