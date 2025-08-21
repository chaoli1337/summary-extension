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

export class OpenAIAPI extends BaseAPIProvider {
  private readonly endpoint = 'https://api.openai.com/v1/chat/completions';

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

    const promptConfig = getPromptConfig(language, customPrompts);
    const model = getModelIdentifier('openai', modelIdentifier);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
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

        let enhancedError = `OpenAI API request failed (${statusCode} ${statusText}): ${errorDetails}`;

        if (statusCode === 401) {
          enhancedError += '\n\nTip: Check if your OpenAI API key is valid. Get one from https://platform.openai.com/';
        } else if (statusCode === 404) {
          enhancedError += '\n\nTip: The model may not be available. Check available models at https://platform.openai.com/docs/models';
        } else if (statusCode === 429) {
          enhancedError += '\n\nTip: Rate limit exceeded. Please wait before trying again or check your usage limits.';
        } else if (statusCode >= 500) {
          enhancedError += '\n\nTip: OpenAI service error. The service may be temporarily unavailable.';
        }

        throw new Error(enhancedError);
      }

      const data = await response.json();
      const summary = data.choices?.[0]?.message?.content || 'No response generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to OpenAI API. Check your internet connection.');
      }
      throw error;
    }
  }
}

export const openAIAPI = new OpenAIAPI();