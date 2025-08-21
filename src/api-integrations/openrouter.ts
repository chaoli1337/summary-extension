import {
  LLMResponse,
  ChatMessage,
  Language,
  CustomPrompts,
  getPromptConfig,
  createPrompt,
  getModelIdentifier,
  BaseAPIProvider
} from './types';

interface _APIConfig {
  apiKey: string;
  modelIdentifier?: string;
  apiUrl?: string;
}

export class OpenRouterAPI extends BaseAPIProvider {
  private readonly defaultEndpoint = 'https://openrouter.ai/api/v1/chat/completions';

  // Unified API method that handles both text and chat messages
  async callAPI(
    messagesOrText: ChatMessage[] | string,
    language: Language = 'chinese',
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse> {
    this.validateConfig();
    if (!this.config) {
      throw new Error('API configuration not initialized');
    }
    const { apiKey, apiUrl, modelIdentifier } = this.config;

    // Convert text to ChatMessage format if needed
    let messages: ChatMessage[];
    if (typeof messagesOrText === 'string') {
      // Legacy text format - convert to messages
      const promptConfig = getPromptConfig(language, customPrompts);
      messages = [
        {
          role: 'system',
          content: promptConfig.systemPrompt
        },
        {
          role: 'user',
          content: createPrompt(messagesOrText, language, customPrompts)
        }
      ];
    } else {
      messages = messagesOrText;
    }


    const endpoint = apiUrl || this.defaultEndpoint;
    const promptConfig = getPromptConfig(language, customPrompts);

    // OpenRouter uses provider/model format (e.g., 'openai/gpt-4', 'anthropic/claude-3-5-sonnet')
    // The model identifier should already include the provider prefix
    const model = getModelIdentifier('openrouter', modelIdentifier);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': chrome.runtime.getURL(''),
          'X-Title': 'AI Page Summarizer'
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: promptConfig.maxTokens,
          temperature: promptConfig.temperature
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorDetails = errorData.error?.message || errorData.message || 'Unknown error';
        const statusCode = response.status;
        const statusText = response.statusText;

        let enhancedError = `API request failed (${statusCode} ${statusText}): ${errorDetails}`;

        if (statusCode === 401) {
          enhancedError += '\n\nTip: Check if your API key is valid and active.';
        } else if (statusCode === 429) {
          enhancedError += '\n\nTip: You have hit rate limits. Please wait before trying again.';
        } else if (statusCode >= 500) {
          enhancedError += '\n\nTip: This is a server error. The API service may be temporarily unavailable.';
        }

        throw new Error(enhancedError);
      }

      const data = await response.json();
      const summary = data.choices?.[0]?.message?.content || 'No response generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Unable to connect to API endpoint. Check your internet connection and URL: ${endpoint}`);
      }
      throw error;
    }
  }
}

export const openRouterAPI = new OpenRouterAPI();