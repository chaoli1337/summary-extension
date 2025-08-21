import Portkey from 'portkey-ai';
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
  virtualKey?: string;
  modelIdentifier?: string;
  apiUrl?: string;
}

export class PortkeyAPI extends BaseAPIProvider {
  private readonly defaultEndpoint = 'https://api.portkey.ai/v1/chat/completions';

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
    const { apiKey, apiUrl, virtualKey, modelIdentifier } = this.config;

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


    try {
      // Try SDK approach first
      try {
        const portkeyConfig: {
          apiKey: string;
          virtualKey?: string;
          baseURL?: string;
        } = {
          apiKey: apiKey
        };

        if (virtualKey) {
          portkeyConfig.virtualKey = virtualKey;
        }

        if (apiUrl) {
          portkeyConfig.baseURL = apiUrl;
        }

        const portkey = new Portkey(portkeyConfig);
        const promptConfig = getPromptConfig(language, customPrompts);
        const model = getModelIdentifier('portkey', modelIdentifier);

        const response = await portkey.chat.completions.create({
          messages: messages,
          model: model,
          max_tokens: promptConfig.maxTokens,
          temperature: promptConfig.temperature
        });

        const summary = response.choices?.[0]?.message?.content?.toString() || 'No response generated';
        return { summary };
      } catch {
        // If SDK fails, fall back to direct API call
        return await this.callDirectChatAPI(messages, language, customPrompts);
      }
    } catch (error: unknown) {
      let errorMessage = 'Portkey API request failed';

      if (error && typeof error === 'object' && 'status' in error) {
        const statusCode = typeof error.status === 'number' ? error.status : 0;
        const errorDetails = ('message' in error ? error.message : '') ||
          (error && typeof error === 'object' && 'error' in error && error.error && typeof error.error === 'object' && 'message' in error.error ? error.error.message : '') ||
          'Unknown error';

        errorMessage = `Portkey API request failed (${statusCode}): ${errorDetails}`;

        if (statusCode === 401) {
          errorMessage += '\n\nTip: Check if your Portkey API key is valid and active.';
        } else if (statusCode === 403) {
          errorMessage += '\n\nTip: Check if your virtual key is valid and has the required permissions.';
        } else if (statusCode === 429) {
          errorMessage += '\n\nTip: You have hit rate limits. Please wait before trying again.';
        } else if (statusCode >= 500) {
          errorMessage += '\n\nTip: This is a server error. The Portkey service may be temporarily unavailable.';
        }
      } else if (error && typeof error === 'object' && 'message' in error) {
        errorMessage += `: ${error.message}`;
      }

      throw new Error(errorMessage);
    }
  }

  private async callDirectChatAPI(
    messages: ChatMessage[],
    language: Language = 'chinese',
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse> {
    if (!this.config) {
      throw new Error('API configuration not initialized');
    }
    const { apiKey, apiUrl, virtualKey, modelIdentifier } = this.config;
    const endpoint = apiUrl || this.defaultEndpoint;

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'AI Page Summarizer'
      };

      if (virtualKey) {
        headers['x-portkey-virtual-key'] = virtualKey;
      }

      const promptConfig = getPromptConfig(language, customPrompts);
      const model = getModelIdentifier('portkey', modelIdentifier);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
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

        let enhancedError = `Portkey API request failed (${statusCode} ${statusText}): ${errorDetails}`;

        if (statusCode === 401) {
          enhancedError += '\n\nTip: Check if your Portkey API key is valid and active.';
        } else if (statusCode === 403) {
          enhancedError += '\n\nTip: Check if your virtual key is valid and has the required permissions.';
        } else if (statusCode === 429) {
          enhancedError += '\n\nTip: You have hit rate limits. Please wait before trying again.';
        } else if (statusCode >= 500) {
          enhancedError += '\n\nTip: This is a server error. The Portkey service may be temporarily unavailable.';
        }

        throw new Error(enhancedError);
      }

      const data = await response.json();
      const summary = data.choices?.[0]?.message?.content || 'No response generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Unable to connect to Portkey API endpoint. Check your internet connection and URL: ${endpoint}`);
      }
      throw error;
    }
  }

  // Large context processing helper
  processLargeContext(
    messages: ChatMessage[],
    maxTokens: number
  ): ChatMessage[] {
    // Rough token estimation (4 characters per token)
    const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

    let totalTokens = 0;
    const processedMessages: ChatMessage[] = [];

    // Always keep system message
    if (messages.length > 0 && messages[0].role === 'system') {
      processedMessages.push(messages[0]);
      totalTokens += estimateTokens(messages[0].content);
    }

    // Process remaining messages from newest to oldest (keep most recent)
    const remainingMessages = messages.slice(1).reverse();

    for (const message of remainingMessages) {
      const messageTokens = estimateTokens(message.content);

      // Reserve space for response (roughly 1/3 of max tokens)
      const reservedTokens = Math.floor(maxTokens / 3);
      const availableTokens = maxTokens - reservedTokens;

      if (totalTokens + messageTokens <= availableTokens) {
        processedMessages.unshift(message); // Add to beginning (maintain order)
        totalTokens += messageTokens;
      } else {
        // If message is too long, truncate it
        if (messageTokens > availableTokens - totalTokens) {
          const availableChars = (availableTokens - totalTokens) * 4;
          const truncatedContent = message.content.substring(0, availableChars) + '...';
          processedMessages.unshift({
            role: message.role,
            content: truncatedContent
          });
          break;
        }
      }
    }

    return processedMessages;
  }

  async callLargeContextAPI(
    messages: ChatMessage[],
    language: Language = 'chinese',
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse> {
    const promptConfig = getPromptConfig(language, customPrompts);
    const processedMessages = this.processLargeContext(messages, promptConfig.maxTokens);

    return this.callAPI(processedMessages, language, customPrompts);
  }
}

export const portkeyAPI = new PortkeyAPI();