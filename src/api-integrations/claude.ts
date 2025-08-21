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
}

export class ClaudeAPI extends BaseAPIProvider {
  private readonly endpoint = 'https://api.anthropic.com/v1/messages';

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
    const { apiKey, modelIdentifier } = this.config;

    // Convert text to ChatMessage format if needed
    let messages: ChatMessage[];
    if (typeof messagesOrText === 'string') {
      // Legacy text format - convert to messages
      messages = [
        {
          role: 'user',
          content: createPrompt(messagesOrText, language, customPrompts)
        }
      ];
    } else {
      messages = messagesOrText;
    }


    const promptConfig = getPromptConfig(language, customPrompts);
    const model = getModelIdentifier('claude', modelIdentifier);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: promptConfig.maxTokens,
          messages: messages
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorDetails = errorData.error?.message || errorData.message || 'Unknown error';
        const statusCode = response.status;
        const statusText = response.statusText;

        throw new Error(`Claude API request failed (${statusCode} ${statusText}): ${errorDetails}`);
      }

      const data = await response.json();
      const summary = data.content?.[0]?.text || 'No response generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to Claude API. Check your internet connection.');
      }
      throw error;
    }
  }
}

export const claudeAPI = new ClaudeAPI();