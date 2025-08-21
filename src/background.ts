// Background service worker for managing tabs and API calls
import { SummaryCache } from './cache';
import { ClaudeAPI } from './api-integrations/claude';
import { OpenAIAPI } from './api-integrations/openai';
import { OpenRouterAPI } from './api-integrations/openrouter';
import { PortkeyAPI } from './api-integrations/portkey';
import {
  LLMResponse,
  ChatMessage,
  ChatRequest,
  Language,
  CustomPrompts,
  APIProvider,
  APIProviderInterface,
  APIConfig,
  textToChatMessages
} from './api-integrations/types';

interface TabInfo {
  id: number;
  url: string;
  title: string;
  text?: string;
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
  private cleanupInterval: NodeJS.Timeout | null = null;
  private conversationContexts = new Map<string, ChatMessage[]>();

  // API Provider instances
  private readonly apiProviders = new Map<APIProvider, APIProviderInterface>([
    ['claude', new ClaudeAPI()],
    ['openai', new OpenAIAPI()],
    ['openrouter', new OpenRouterAPI()],
    ['portkey', new PortkeyAPI()]
  ]);

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
        this.pendingRequests.delete(id);
      }
    }
  }

  async getAllTabsInfo(): Promise<TabInfo[]> {
    try {
      const tabs = await chrome.tabs.query({});
      return tabs.map(tab => ({
        id: tab.id || -1,
        url: tab.url || '',
        title: tab.title || 'Untitled'
      })).filter(tab => tab.id !== -1);
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
                if (!parent) {
                  return NodeFilter.FILTER_REJECT;
                }

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
          let node: Node | null;

          while ((node = walker.nextNode())) {
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

  async startLLMRequest(request: ChatRequest, requestId?: string): Promise<string> {
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

  async processLLMRequest(requestId: string, request: ChatRequest): Promise<void> {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

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
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private getApiProvider(provider: APIProvider): APIProviderInterface {
    const apiProvider = this.apiProviders.get(provider);
    if (!apiProvider) {
      throw new Error(`Unknown API provider: ${provider}`);
    }
    return apiProvider;
  }

  private initializeApiProvider(provider: APIProvider, config: APIConfig): void {
    const apiProvider = this.getApiProvider(provider);
    apiProvider.initialize(config);
  }

  async callLLMAPI(request: ChatRequest): Promise<LLMResponse> {
    try {
      const { messages, provider, apiKey, apiUrl, virtualKey, modelIdentifier, url, language = 'chinese', forceFresh = false, customPrompts, tabId } = request;

      // Check cache first if URL is provided and not forcing fresh
      // Only check cache for text summarization (single user message)
      if (url && !forceFresh && messages.length === 1 && messages[0].role === 'user') {
        const cachedSummary = await SummaryCache.get(url, language);
        if (cachedSummary) {
          // Get cache entry details for timestamp
          const cacheEntry = await this.getCacheEntry(url, language);
          return {
            summary: cachedSummary,
            fromCache: true,
            cachedAt: cacheEntry?.timestamp
          };
        }
      }

      // Store conversation context for this tab if provided
      if (tabId !== undefined) {
        this.conversationContexts.set(`tab_${tabId}`, messages);
      }

      // Initialize API provider with configuration
      const config: APIConfig = {
        apiKey,
        apiUrl,
        virtualKey,
        modelIdentifier,
        language,
        customPrompts
      };

      this.initializeApiProvider(provider, config);
      const apiProvider = this.getApiProvider(provider);

      // Check if we need special handling for large contexts
      if (provider === 'portkey') {
        const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0);
        const estimatedTokens = Math.ceil(totalLength / 4);

        if (estimatedTokens > 100000 && apiProvider.callLargeContextAPI) {
          // For extremely large contexts, use special handling
          return await this.handleExtremelyLargeContext(messages, config, language, customPrompts);
        } else if (apiProvider.callLargeContextAPI) {
          return await apiProvider.callLargeContextAPI(messages, language, customPrompts);
        }
      }

      // Make API call
      const apiResponse = await apiProvider.callAPI(messages, language, customPrompts);

      // Cache the response if successful and URL is provided (only for text summarization)
      if (url && apiResponse.summary && !apiResponse.error && messages.length === 1 && messages[0].role === 'user') {
        await SummaryCache.set(url, language, apiResponse.summary, provider);
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

  private async getCacheEntry(url: string, language: string): Promise<{ timestamp?: number } | null> {
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

  async openDetachedWindow(): Promise<void> {
    try {
      // Check if detached popup window already exists
      const existingWindows = await chrome.windows.getAll({ populate: true });
      const popupWindow = existingWindows.find(window =>
        window.type === 'popup' &&
        window.tabs?.some(tab => tab.url?.includes('popup.html'))
      );

      if (popupWindow && popupWindow.id) {
        // Focus existing popup window
        await chrome.windows.update(popupWindow.id, { focused: true });
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

  async getCacheStats() {
    return await SummaryCache.getStats();
  }

  async clearCache() {
    return await SummaryCache.clear();
  }

  // Handle extremely large contexts (1M+ tokens) with smart chunking
  private async handleExtremelyLargeContext(
    messages: ChatMessage[],
    config: APIConfig,
    language: Language = 'chinese',
    customPrompts?: CustomPrompts
  ): Promise<LLMResponse> {

    // Get Portkey API instance
    const portkeyProvider = this.getApiProvider('portkey') as PortkeyAPI;
    portkeyProvider.initialize(config);

    // If context is manageable, use regular large context API
    const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const estimatedTokens = Math.ceil(totalLength / 4);

    // If under 100K tokens, use regular processing
    if (estimatedTokens < 100000 && portkeyProvider.callLargeContextAPI) {
      return await portkeyProvider.callLargeContextAPI(messages, language, customPrompts);
    }

    // For extremely large contexts, implement smart chunking
    const chunkedMessages = this.chunkLargeContext(messages);

    // Process each chunk and maintain conversation flow
    let processedContext = '';
    let conversationSummary = '';

    for (let i = 0; i < chunkedMessages.length; i++) {
      const chunk = chunkedMessages[i];

      // Create a summary of previous chunks if we have them
      if (i > 0 && processedContext.length > 0) {
        try {
          const summaryResponse = await portkeyProvider.callAPI(
            processedContext,
            language,
            customPrompts
          );
          conversationSummary = summaryResponse.summary;
        } catch (error) {
          console.warn('Failed to create conversation summary:', error);
        }
      }

      // Process current chunk
      const chunkWithSummary = this.integrateSummaryWithChunk(chunk, conversationSummary, language);

      try {
        let response: LLMResponse;
        if (portkeyProvider.callLargeContextAPI) {
          response = await portkeyProvider.callLargeContextAPI(
            chunkWithSummary,
            language,
            customPrompts
          );
        } else {
          throw new Error('Large context API not available');
        }

        // Update processed context
        processedContext += '\n\n' + chunk.map(msg => `${msg.role}: ${msg.content}`).join('\n');

        // If this is the last chunk, return the response
        if (i === chunkedMessages.length - 1) {
          return response;
        }

      } catch (error) {
        console.error(`Error processing chunk ${i}:`, error);
        throw error;
      }
    }

    throw new Error('Failed to process large context');
  }

  // Chunk large context into manageable pieces
  private chunkLargeContext(messages: ChatMessage[]): ChatMessage[][] {
    const maxChunkSize = 50000; // ~50K tokens per chunk
    const chunks: ChatMessage[][] = [];
    let currentChunk: ChatMessage[] = [];
    let currentChunkSize = 0;

    for (const message of messages) {
      const messageSize = message.content.length;

      // If adding this message would exceed chunk size, start a new chunk
      if (currentChunkSize + messageSize > maxChunkSize && currentChunk.length > 0) {
        chunks.push([...currentChunk]);
        currentChunk = [];
        currentChunkSize = 0;
      }

      // Add message to current chunk
      currentChunk.push(message);
      currentChunkSize += messageSize;
    }

    // Add the last chunk if it has content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  // Integrate conversation summary with current chunk
  private integrateSummaryWithChunk(
    chunk: ChatMessage[],
    summary: string,
    language: Language
  ): ChatMessage[] {

    if (!summary) {
      return chunk;
    }

    const summaryMessage: ChatMessage = {
      role: 'system',
      content: language === 'chinese'
        ? `之前的对话摘要：${summary}\n\n请基于这个摘要和当前对话继续回答。`
        : `Previous conversation summary: ${summary}\n\nPlease continue the conversation based on this summary and the current dialogue.`
    };

    return [summaryMessage, ...chunk];
  }

  getConversationContext(tabId: number): ChatMessage[] | null {
    const key = `tab_${tabId}`;
    return this.conversationContexts.get(key) || null;
  }

  clearConversationContext(tabId: number): void {
    const key = `tab_${tabId}`;
    this.conversationContexts.delete(key);
  }

  clearAllConversationContexts(): void {
    this.conversationContexts.clear();
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

    case 'startSummarize': {
      // Start async summarization and return request ID immediately
      // Convert text to ChatMessage format
      const { text, ...restData } = request.data;
      const messages = textToChatMessages(text, request.data.language, request.data.customPrompts);
      const dataWithUrl: ChatRequest = {
        ...restData,
        messages,
        url: request.url,
        forceFresh: request.forceFresh
      };
      service.startLLMRequest(dataWithUrl, request.requestId).then(requestId => {
        sendResponse({ requestId });
      }).catch(error => {
        sendResponse({ error: error.message });
      });
      return true;
    }

    case 'getRequestStatus': {
      // Check status of a request by ID
      const status = service.getRequestStatus(request.requestId);
      sendResponse(status);
      return true;
    }

    case 'summarizeText': {
      // Legacy synchronous method (kept for compatibility)
      // Convert text to ChatMessage format
      const { text: legacyText, ...legacyRestData } = request.data;
      const legacyMessages = textToChatMessages(legacyText, request.data.language, request.data.customPrompts);
      const legacyDataWithUrl: ChatRequest = {
        ...legacyRestData,
        messages: legacyMessages,
        url: request.url,
        forceFresh: request.forceFresh
      };
      service.callLLMAPI(legacyDataWithUrl).then(sendResponse);
      return true;
    }

    case 'openDetachedWindow':
      service.openDetachedWindow().then(sendResponse);
      return true;

    case 'getCacheStats':
      service.getCacheStats().then(sendResponse);
      return true;

    case 'clearCache':
      service.clearCache().then(() => sendResponse({ success: true }));
      return true;

    case 'chatMessage': {
      // Include tab ID for context tracking
      const chatRequest = { ...request.data, tabId: request.tabId };
      service.callLLMAPI(chatRequest).then(sendResponse);
      return true;
    }

    case 'getConversationContext': {
      // Get stored conversation context for a tab
      const context = service.getConversationContext(request.tabId);
      sendResponse({ context });
      return true;
    }

    case 'clearConversationContext':
      // Clear conversation context for a tab
      service.clearConversationContext(request.tabId);
      sendResponse({ success: true });
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

// The extension now uses default popup behavior defined in manifest.json
// No need for custom action click handler

// Extension installation
chrome.runtime.onInstalled.addListener(() => {
  // Extension installed
});