// Background service worker for managing tabs and API calls
import { SummaryCache } from './cache';
import Portkey from 'portkey-ai';

// Custom fetch adapter for Chrome extension service worker context
const customFetch = async (url: string, options: RequestInit): Promise<Response> => {
  return fetch(url, {
    ...options,
    // Ensure we're using the global fetch properly
    mode: 'cors',
    credentials: 'omit'
  });
};

// Test cache import immediately
console.log('🧪 CACHE MODULE IMPORT TEST:', typeof SummaryCache);
console.log('🧪 CACHE HAS GET METHOD:', typeof SummaryCache.get);
console.log('🧪 CACHE HAS SET METHOD:', typeof SummaryCache.set);

interface TabInfo {
  id: number;
  url: string;
  title: string;
  text?: string;
}

interface LLMRequest {
  text: string;
  model: 'claude' | 'openai' | 'portkey';
  apiKey: string;
  apiUrl?: string;
  virtualKey?: string;
  language?: 'chinese' | 'english';
  customPrompts?: {
    chinese: {
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      maxTokens: number;
    };
    english: {
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      maxTokens: number;
    };
  };
}

interface ChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model: 'claude' | 'openai' | 'portkey';
  apiKey: string;
  apiUrl?: string;
  virtualKey?: string;
  language?: 'chinese' | 'english';
  customPrompts?: {
    chinese: {
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      maxTokens: number;
    };
    english: {
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      maxTokens: number;
    };
  };
}

interface LLMResponse {
  summary: string;
  error?: string;
  fromCache?: boolean;
  cachedAt?: number;
}

interface PendingRequest {
  id: string;
  tabUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: LLMResponse;
  error?: string;
  timestamp: number;
}

class BackgroundService {
  private static instance: BackgroundService;
  private pendingRequests = new Map<string, PendingRequest>();
  private cleanupInterval: any = null;

  static getInstance(): BackgroundService {
    if (!this.instance) {
      this.instance = new BackgroundService();
      this.instance.startCleanupTimer();
    }
    return this.instance;
  }

  private startCleanupTimer() {
    // Clean up old requests every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldRequests();
    }, 5 * 60 * 1000);
  }

  private cleanupOldRequests() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    for (const [id, request] of this.pendingRequests) {
      if (now - request.timestamp > maxAge) {
        console.log('Cleaning up old request:', id);
        this.pendingRequests.delete(id);
      }
    }
  }

  async getAllTabsInfo(): Promise<TabInfo[]> {
    try {
      const tabs = await chrome.tabs.query({});
      return tabs.map(tab => ({
        id: tab.id!,
        url: tab.url || '',
        title: tab.title || 'Untitled'
      }));
    } catch (error) {
      console.error('Error getting tabs info:', error);
      return [];
    }
  }

  async extractTextFromTab(tabId: number): Promise<string> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Extract text content from the page
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;

                const style = window.getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') {
                  return NodeFilter.FILTER_REJECT;
                }

                const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME']);
                if (ignoredTags.has(parent.tagName)) {
                  return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );

          const textNodes: string[] = [];
          let node;

          while (node = walker.nextNode()) {
            const text = node.textContent?.trim();
            if (text && text.length > 0) {
              textNodes.push(text);
            }
          }

          return textNodes.join(' ').replace(/\s+/g, ' ').trim();
        }
      });

      return results[0]?.result || '';
    } catch (error) {
      console.error('Error extracting text from tab:', error);
      return '';
    }
  }

  async startLLMRequest(request: LLMRequest & { url?: string; forceFresh?: boolean }, requestId?: string): Promise<string> {
    const id = requestId || this.generateRequestId();
    const pendingRequest: PendingRequest = {
      id,
      tabUrl: request.url || '',
      status: 'pending',
      timestamp: Date.now()
    };
    
    this.pendingRequests.set(id, pendingRequest);
    
    // Process request asynchronously
    this.processLLMRequest(id, request).catch(error => {
      console.error('LLM request processing failed:', error);
      const req = this.pendingRequests.get(id);
      if (req) {
        req.status = 'error';
        req.error = error instanceof Error ? error.message : 'Unknown error';
        this.pendingRequests.set(id, req);
      }
    });
    
    return id;
  }

  async processLLMRequest(requestId: string, request: LLMRequest & { url?: string; forceFresh?: boolean }): Promise<void> {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) return;
    
    pendingRequest.status = 'processing';
    this.pendingRequests.set(requestId, pendingRequest);
    
    try {
      const result = await this.callLLMAPI(request);
      pendingRequest.status = 'completed';
      pendingRequest.result = result;
      this.pendingRequests.set(requestId, pendingRequest);
    } catch (error) {
      pendingRequest.status = 'error';
      pendingRequest.error = error instanceof Error ? error.message : 'Unknown error';
      this.pendingRequests.set(requestId, pendingRequest);
    }
  }

  getRequestStatus(requestId: string): PendingRequest | null {
    return this.pendingRequests.get(requestId) || null;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async callLLMAPI(request: LLMRequest & { url?: string; forceFresh?: boolean }): Promise<LLMResponse> {
    try {
      const { text, model, apiKey, apiUrl, url, language = 'chinese', forceFresh = false } = request;

      console.log('🔥🔥🔥 === CACHE DEBUG START === 🔥🔥🔥');
      console.log('LLM API called with:', { url, model, language, hasText: !!text, forceFresh });

      // Check cache first if URL is provided and not forcing fresh
      if (url && !forceFresh) {
        console.log('🔍🔍🔍 ABOUT TO CHECK CACHE 🔍🔍🔍');
        console.log('Checking cache for URL and language:', url, language);
        const cachedSummary = await SummaryCache.get(url, language);
        if (cachedSummary) {
          console.log('🎯 CACHE HIT - Returning cached summary for:', `${url}|${language}`);
          // Get cache entry details for timestamp
          const cacheEntry = await this.getCacheEntry(url, language);
          return { 
            summary: cachedSummary,
            fromCache: true,
            cachedAt: cacheEntry?.timestamp
          };
        }
        console.log('❌ CACHE MISS - No cached summary found for:', `${url}|${language}`);
      } else if (forceFresh) {
        console.log('🔄 FORCE FRESH - Skipping cache check due to forceFresh flag');
      } else {
        console.log('⚠️ No URL provided, skipping cache check');
      }

      // Cache miss or no URL provided, make API call
      console.log('🌐 Making fresh API call...');
      let apiResponse: LLMResponse;

      if (model === 'claude') {
        console.log('Using Anthropic Claude API');
        apiResponse = await this.callClaudeAPI(text, apiKey, language, request.customPrompts);
      } else if (model === 'portkey') {
        console.log('Using Portkey API');
        apiResponse = await this.callPortkeyAPI(text, apiKey, apiUrl, request.virtualKey, language, request.customPrompts);
      } else {
        console.log('Using OpenRouter API');
        apiResponse = await this.callOpenRouterAPI(text, model, apiKey, apiUrl, language, request.customPrompts);
      }

      // Cache the response if successful and URL is provided
      if (url && apiResponse.summary && !apiResponse.error) {
        console.log('💾💾💾 ABOUT TO STORE IN CACHE 💾💾💾');
        console.log('💾 Storing in cache:', { url, language, responseLength: apiResponse.summary.length });
        await SummaryCache.set(url, language, apiResponse.summary, model);
        console.log('✅ Successfully cached response for:', `${url}|${language}`);
      } else {
        console.log('❌ Not caching because:', {
          hasUrl: !!url,
          hasSummary: !!apiResponse.summary,
          hasError: !!apiResponse.error
        });
      }

      return apiResponse;
    } catch (error) {
      console.error('LLM API call failed:', error);
      return {
        summary: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getCacheEntry(url: string, language: string): Promise<any> {
    try {
      const result = await chrome.storage.local.get(['summary_cache']);
      const cache = result['summary_cache'] || {};
      const cacheKey = `${url}|${language}`;
      return cache[cacheKey] || null;
    } catch (error) {
      console.error('Error getting cache entry:', error);
      return null;
    }
  }

  private async callClaudeAPI(text: string, apiKey: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    const endpoint = 'https://api.anthropic.com/v1/messages';

    // Get prompt configuration
    const promptConfig = this.getPromptConfig(language, customPrompts);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: promptConfig.maxTokens,
          messages: [
            {
              role: 'user',
              content: this.createPrompt(text, language, customPrompts)
            }
          ]
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
      const summary = data.content?.[0]?.text || 'No summary generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Unable to connect to Claude API. Check your internet connection.`);
      }
      throw error;
    }
  }

  private async callOpenRouterAPI(text: string, model: 'claude' | 'openai', apiKey: string, apiUrl?: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    const endpoint = apiUrl || 'https://openrouter.ai/api/v1/chat/completions';

    const modelMap = {
      'claude': 'anthropic/claude-sonnet-4-20250514',
      'openai': 'openai/gpt-4'
    };

    // Get prompt configuration
    const promptConfig = this.getPromptConfig(language, customPrompts);

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
          model: modelMap[model],
          messages: [
            {
              role: 'system',
              content: promptConfig.systemPrompt
            },
            {
              role: 'user',
              content: this.createPrompt(text, language, customPrompts)
            }
          ],
          max_tokens: promptConfig.maxTokens,
          temperature: promptConfig.temperature
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorDetails = errorData.error?.message || errorData.message || 'Unknown error';
        const statusCode = response.status;
        const statusText = response.statusText;

        // Provide more specific error messages
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
      const summary = data.choices?.[0]?.message?.content || 'No summary generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Unable to connect to API endpoint. Check your internet connection and URL: ${endpoint}`);
      }
      throw error;
    }
  }

  private async callPortkeyAPI(text: string, apiKey: string, apiUrl?: string, virtualKey?: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    try {
      // Try SDK approach first
      try {
        const portkeyConfig: any = {
          apiKey: apiKey
        };

        // Add virtual key if provided
        if (virtualKey) {
          portkeyConfig.virtualKey = virtualKey;
        }

        // Add custom base URL if provided
        if (apiUrl) {
          portkeyConfig.baseURL = apiUrl;
        }

        const portkey = new Portkey(portkeyConfig);

        // Get prompt configuration
        const promptConfig = this.getPromptConfig(language, customPrompts);

        // Create chat completion using SDK
        const response = await portkey.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: promptConfig.systemPrompt
            },
            {
              role: 'user',
              content: this.createPrompt(text, language, customPrompts)
            }
          ],
          model: 'gpt-4', // Default model, can be overridden by virtual key
          max_tokens: promptConfig.maxTokens,
          temperature: promptConfig.temperature
        });

        const summary = response.choices?.[0]?.message?.content?.toString() || 'No summary generated';
        return { summary };
      } catch (sdkError: any) {
        // If SDK fails, fall back to direct API call
        console.log('Portkey SDK failed, falling back to direct API call:', sdkError.message);
        return await this.callPortkeyDirectAPI(text, apiKey, apiUrl, virtualKey, language, customPrompts);
      }
    } catch (error: any) {
      // Handle SDK-specific errors
      let errorMessage = 'Portkey API request failed';
      
      if (error?.status) {
        const statusCode = error.status;
        const errorDetails = error.message || error.error?.message || 'Unknown error';
        
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
      } else if (error?.message) {
        errorMessage += `: ${error.message}`;
      }

      throw new Error(errorMessage);
    }
  }

  private async callPortkeyDirectAPI(text: string, apiKey: string, apiUrl?: string, virtualKey?: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    const endpoint = apiUrl || 'https://api.portkey.ai/v1/chat/completions';

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'AI Page Summarizer'
      };

      // Add virtual key if provided
      if (virtualKey) {
        headers['x-portkey-virtual-key'] = virtualKey;
      }

      // Get prompt configuration
      const promptConfig = this.getPromptConfig(language, customPrompts);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-4', // Default model, can be overridden by virtual key
          messages: [
            {
              role: 'system',
              content: promptConfig.systemPrompt
            },
            {
              role: 'user',
              content: this.createPrompt(text, language, customPrompts)
            }
          ],
          max_tokens: promptConfig.maxTokens,
          temperature: promptConfig.temperature
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorDetails = errorData.error?.message || errorData.message || 'Unknown error';
        const statusCode = response.status;
        const statusText = response.statusText;

        // Provide more specific error messages
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
      const summary = data.choices?.[0]?.message?.content || 'No summary generated';
      return { summary };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Unable to connect to Portkey API endpoint. Check your internet connection and URL: ${endpoint}`);
      }
      throw error;
    }
  }

  async openDetachedWindow(): Promise<void> {
    try {
      // Check if detached popup window already exists
      const existingWindows = await chrome.windows.getAll({ populate: true });
      const popupWindow = existingWindows.find(window =>
        window.type === 'popup' &&
        window.tabs?.some(tab => tab.url?.includes('popup.html'))
      );

      if (popupWindow) {
        // Focus existing popup window
        await chrome.windows.update(popupWindow.id!, { focused: true });
      } else {
        // Create new popup window
        await chrome.windows.create({
          url: chrome.runtime.getURL('popup.html'),
          type: 'popup',
          width: 400,
          height: 500,
          focused: true
        });
      }
    } catch (error) {
      console.error('Error creating detached popup window:', error);
      throw error;
    }
  }

  private getPromptConfig(language: 'chinese' | 'english', customPrompts?: any) {
    const defaultConfig = {
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

    if (customPrompts && customPrompts[language]) {
      return customPrompts[language];
    }

    return defaultConfig[language];
  }

  private createPrompt(text: string, language: 'chinese' | 'english', customPrompts?: any): string {
    const promptConfig = this.getPromptConfig(language, customPrompts);
    return promptConfig.userPrompt.replace('{text}', text);
  }

  async getCacheStats() {
    return await SummaryCache.getStats();
  }

  async clearCache() {
    return await SummaryCache.clear();
  }

  async callChatAPI(request: ChatRequest): Promise<LLMResponse> {
    try {
      const { messages, model, apiKey, apiUrl, virtualKey, language = 'chinese', customPrompts } = request;

      console.log('Chat API called with:', { model, language, messageCount: messages.length });

      let apiResponse: LLMResponse;

      if (model === 'claude') {
        console.log('Using Anthropic Claude API for chat');
        apiResponse = await this.callClaudeChatAPI(messages, apiKey, language, customPrompts);
      } else if (model === 'portkey') {
        console.log('Using Portkey API for chat');
        apiResponse = await this.callPortkeyChatAPI(messages, apiKey, apiUrl, virtualKey, language, customPrompts);
      } else {
        console.log('Using OpenRouter API for chat');
        apiResponse = await this.callOpenRouterChatAPI(messages, model, apiKey, apiUrl, language, customPrompts);
      }

      return apiResponse;
    } catch (error) {
      console.error('Chat API call failed:', error);
      return {
        summary: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async callClaudeChatAPI(messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>, apiKey: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    const endpoint = 'https://api.anthropic.com/v1/messages';

    // Get prompt configuration for chat
    const promptConfig = this.getPromptConfig(language, customPrompts);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
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
        throw new Error(`Network error: Unable to connect to Claude API. Check your internet connection.`);
      }
      throw error;
    }
  }

  private async callOpenRouterChatAPI(messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>, model: 'claude' | 'openai', apiKey: string, apiUrl?: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    const endpoint = apiUrl || 'https://openrouter.ai/api/v1/chat/completions';

    const modelMap = {
      'claude': 'anthropic/claude-sonnet-4-20250514',
      'openai': 'openai/gpt-4'
    };

    // Get prompt configuration for chat
    const promptConfig = this.getPromptConfig(language, customPrompts);

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
          model: modelMap[model],
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

  private async callPortkeyChatAPI(messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>, apiKey: string, apiUrl?: string, virtualKey?: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    try {
      // Try SDK approach first
      try {
        const portkeyConfig: any = {
          apiKey: apiKey
        };

        // Add virtual key if provided
        if (virtualKey) {
          portkeyConfig.virtualKey = virtualKey;
        }

        // Add custom base URL if provided
        if (apiUrl) {
          portkeyConfig.baseURL = apiUrl;
        }

        const portkey = new Portkey(portkeyConfig);

        // Get prompt configuration for chat
        const promptConfig = this.getPromptConfig(language, customPrompts);

        // Create chat completion using SDK
        const response = await portkey.chat.completions.create({
          messages: messages,
          model: 'gpt-4', // Default model, can be overridden by virtual key
          max_tokens: promptConfig.maxTokens,
          temperature: promptConfig.temperature
        });

        const summary = response.choices?.[0]?.message?.content?.toString() || 'No response generated';
        return { summary };
      } catch (sdkError: any) {
        // If SDK fails, fall back to direct API call
        console.log('Portkey SDK failed, falling back to direct API call:', sdkError.message);
        return await this.callPortkeyDirectChatAPI(messages, apiKey, apiUrl, virtualKey, language, customPrompts);
      }
    } catch (error: any) {
      // Handle SDK-specific errors
      let errorMessage = 'Portkey API request failed';
      
      if (error?.status) {
        const statusCode = error.status;
        const errorDetails = error.message || error.error?.message || 'Unknown error';
        
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
      } else if (error?.message) {
        errorMessage += `: ${error.message}`;
      }

      throw new Error(errorMessage);
    }
  }

  private async callPortkeyDirectChatAPI(messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>, apiKey: string, apiUrl?: string, virtualKey?: string, language: 'chinese' | 'english' = 'chinese', customPrompts?: any): Promise<LLMResponse> {
    const endpoint = apiUrl || 'https://api.portkey.ai/v1/chat/completions';

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'AI Page Summarizer'
      };

      // Add virtual key if provided
      if (virtualKey) {
        headers['x-portkey-virtual-key'] = virtualKey;
      }

      // Get prompt configuration for chat
      const promptConfig = this.getPromptConfig(language, customPrompts);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-4', // Default model, can be overridden by virtual key
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
}

// Message handling
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const service = BackgroundService.getInstance();

  switch (request.action) {
    case 'getAllTabs':
      service.getAllTabsInfo().then(sendResponse);
      return true;

    case 'extractTabText':
      service.extractTextFromTab(request.tabId).then(sendResponse);
      return true;

    case 'startSummarize':
      // Start async summarization and return request ID immediately
      console.log('Start summarize request received:', { url: request.url, hasData: !!request.data, forceFresh: request.forceFresh });
      const dataWithUrl = { ...request.data, url: request.url, forceFresh: request.forceFresh };
      service.startLLMRequest(dataWithUrl, request.requestId).then(requestId => {
        sendResponse({ requestId });
      }).catch(error => {
        sendResponse({ error: error.message });
      });
      return true;

    case 'getRequestStatus':
      // Check status of a request by ID
      const status = service.getRequestStatus(request.requestId);
      sendResponse(status);
      return true;

    case 'summarizeText':
      // Legacy synchronous method (kept for compatibility)
      console.log('Summarize request received:', { url: request.url, hasData: !!request.data, forceFresh: request.forceFresh });
      const legacyDataWithUrl = { ...request.data, url: request.url, forceFresh: request.forceFresh };
      service.callLLMAPI(legacyDataWithUrl).then(sendResponse);
      return true;

    case 'openDetachedWindow':
      service.openDetachedWindow().then(sendResponse);
      return true;

    case 'getCacheStats':
      service.getCacheStats().then(sendResponse);
      return true;

    case 'clearCache':
      service.clearCache().then(() => sendResponse({ success: true }));
      return true;

    case 'chatMessage':
      service.callChatAPI(request.data).then(sendResponse);
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

// The extension now uses default popup behavior defined in manifest.json
// No need for custom action click handler

// Extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Page Summarizer extension installed');
});