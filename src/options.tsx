import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

interface Settings {
  provider: 'claude' | 'openai' | 'openrouter' | 'portkey';
  modelIdentifier?: string; // Configurable model identifier
  apiKey: string;
  apiUrl?: string;
  virtualKey?: string;
  language: 'chinese' | 'english';
  autoSummarize?: boolean;
  cacheMaxSize?: number;
  cacheExpiryDays?: number;
  // New prompt configuration
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

interface CacheStats {
  size: number;
  totalBytes: number;
  totalSizeFormatted: string;
  oldestEntry?: string;
  newestEntry?: string;
  entries: Array<{url: string; language: string; timestamp: string; provider: string; sizeBytes: number}>;
}

const Options: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({
    provider: 'claude',
    modelIdentifier: 'claude-sonnet-4-20250514', // Default model identifier
    apiKey: '',
    virtualKey: '',
    language: 'chinese',
    autoSummarize: true,
    cacheMaxSize: 100,
    cacheExpiryDays: 1,
    customPrompts: {
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
    }
  });
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [isLoadingCache, setIsLoadingCache] = useState(false);

  useEffect(() => {
    loadSettings();
    loadCacheStats();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        const loadedSettings = result.settings;
        const provider = loadedSettings.provider || 'claude';
        setSettings(prev => ({
          ...prev,
          ...loadedSettings,
          provider
        }));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async (newSettings: Settings) => {
    try {
      await chrome.storage.local.set({ settings: newSettings });
      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showStatus('Error saving settings', 'error');
    }
  };

  const testApiConnection = async () => {
    if (!settings.apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }

    setIsTestingApi(true);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'summarizeText',
        data: {
          text: 'This is a test message to verify API connectivity.',
          provider: settings.provider,
          modelIdentifier: settings.modelIdentifier,
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          virtualKey: settings.virtualKey,
          language: settings.language,
          customPrompts: settings.customPrompts
        }
      });

      if (response.error) {
        throw new Error(response.error);
      }

      showStatus('API connection successful!', 'success');
    } catch (error) {
      console.error('API test failed:', error);

      let errorMessage = 'API test failed';

      if (error instanceof Error) {
        errorMessage += `:\n\nError: ${error.message}`;

        if (error.message.includes('404')) {
          errorMessage += '\n\nThis usually means the API endpoint URL is incorrect.';
        } else if (error.message.includes('401') || error.message.includes('403')) {
          errorMessage += '\n\nThis usually means your API key is invalid or has insufficient permissions.';
        } else if (error.message.includes('429')) {
          errorMessage += '\n\nRate limit exceeded. Please wait before trying again.';
        } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
          errorMessage += '\n\nServer error. The API service may be temporarily unavailable.';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage += '\n\nNetwork error. Check your internet connection and firewall settings.';
        }

        errorMessage += '\n\nDebug Info:';
        errorMessage += `\nProvider: ${settings.provider}`;
        if (settings.modelIdentifier) {
          errorMessage += `\nModel Identifier: ${settings.modelIdentifier}`;
        }
        if (settings.provider === 'claude') {
          errorMessage += '\nAPI: Anthropic Claude API';
        } else {
          errorMessage += `\nAPI URL: ${settings.apiUrl || 'Default (OpenRouter)'}`;
        }
        errorMessage += `\nAPI Key: ${settings.apiKey ? `${settings.apiKey.substring(0, 8)}...` : 'Not set'}`;
      } else {
        errorMessage += ': Unknown error occurred';
      }

      showStatus(errorMessage, 'error');
    } finally {
      setIsTestingApi(false);
    }
  };

  const loadCacheStats = async () => {
    setIsLoadingCache(true);
    try {
      const stats = await chrome.runtime.sendMessage({ action: 'getCacheStats' });
      setCacheStats(stats);
    } catch (error) {
      console.error('Error loading cache stats:', error);
    } finally {
      setIsLoadingCache(false);
    }
  };

  const clearCache = async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'clearCache' });
      showStatus('Cache cleared successfully!', 'success');
      await loadCacheStats(); // Refresh stats
    } catch (error) {
      console.error('Error clearing cache', error);
      showStatus('Error clearing cache', 'error');
    }
  };

  const resetPromptsToDefault = () => {
    const defaultPrompts = {
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

    setSettings(prev => ({
      ...prev,
      customPrompts: defaultPrompts
    }));
    showStatus('Prompts reset to default values!', 'success');
  };

  const showStatus = (message: string, type: 'success' | 'error') => {
    setStatus({ message, type });
    setTimeout(() => setStatus(null), type === 'error' ? 10000 : 3000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.apiKey) {
      showStatus('API key is required', 'error');
      return;
    }
    saveSettings(settings);
  };

  return (
    <div className="max-w-4xl mx-auto p-8 bg-white min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 pb-6 mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Page Summarizer Options</h1>
        <p className="text-gray-600">Configure your AI page summarizer settings</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* AI Model Section */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">AI Model Configuration</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI Model Provider
              </label>
              <select
                value={settings.provider}
                onChange={(e) => {
                  const newProvider = e.target.value as 'claude' | 'openai' | 'openrouter' | 'portkey';
                  let defaultModelIdentifier = '';

                  // Set appropriate default model identifier based on selected provider
                  switch (newProvider) {
                    case 'claude':
                      defaultModelIdentifier = 'claude-sonnet-4-20250514';
                      break;
                    case 'openai':
                      defaultModelIdentifier = 'gpt-4';
                      break;
                    case 'openrouter':
                      defaultModelIdentifier = 'openai/gpt-4'; // OpenRouter uses provider/model format
                      break;
                    case 'portkey':
                      defaultModelIdentifier = 'gpt-4'; // Use gpt-4 for Portkey by default
                      break;
                  }

                  setSettings(prev => ({
                    ...prev,
                    provider: newProvider,
                    modelIdentifier: defaultModelIdentifier
                  }));
                }}
                className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
              >
                <option value="claude">Claude (Anthropic)</option>
                <option value="openai">OpenAI (Direct)</option>
                <option value="openrouter">OpenRouter (Gateway)</option>
                <option value="portkey">Portkey (Gateway)</option>
              </select>
              <p className="mt-2 text-sm text-gray-500">
                Choose your AI provider: Direct APIs (Claude, OpenAI) or Gateways (OpenRouter, Portkey)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Model Identifier
              </label>
              <input
                type="text"
                value={settings.modelIdentifier || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, modelIdentifier: e.target.value }))}
                placeholder={
                  settings.provider === 'claude' ? 'claude-sonnet-4-20250514' :
                  settings.provider === 'openai' ? 'gpt-4' :
                  settings.provider === 'openrouter' ? 'openai/gpt-4' :
                  'gpt-4'
                }
                className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
              />
              <p className="mt-2 text-sm text-gray-500">
                {settings.provider === 'claude' ?
                  'Claude model identifier (e.g., claude-sonnet-4-20250514, claude-3-opus-20240229)' :
                  settings.provider === 'openai' ?
                  'OpenAI model identifier (e.g., gpt-4, gpt-4-turbo, gpt-3.5-turbo)' :
                  settings.provider === 'openrouter' ?
                  'OpenRouter model with provider prefix (e.g., openai/gpt-4, anthropic/claude-3-5-sonnet)' :
                  'Model identifier for Portkey routing (e.g., gpt-4, claude-3-opus-20240229)'
                }
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key
              </label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="Enter your API key"
                className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
              />
              <p className="mt-2 text-sm text-gray-500">
                Get your API key from{' '}
                {settings.provider === 'claude' ? (
                  <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">console.anthropic.com</a>
                ) : settings.provider === 'openai' ? (
                  <a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">platform.openai.com</a>
                ) : settings.provider === 'openrouter' ? (
                  <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">openrouter.ai</a>
                ) : (
                  <a href="https://app.portkey.ai" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">app.portkey.ai</a>
                )}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API URL (optional)
              </label>
              <input
                type="text"
                value={settings.apiUrl || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, apiUrl: e.target.value }))}
                placeholder={
                  settings.provider === 'claude' ? 'https://api.anthropic.com/v1/messages' :
                  settings.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' :
                  settings.provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' :
                  'https://api.portkey.ai/v1/chat/completions'
                }
                className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
              />
              <p className="mt-2 text-sm text-gray-500">
                Custom API endpoint URL. Leave empty to use default endpoints.
              </p>
            </div>

            {settings.provider === 'portkey' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Virtual Key (optional)
                </label>
                <input
                  type="text"
                  value={settings.virtualKey || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, virtualKey: e.target.value }))}
                  placeholder="Enter your Portkey virtual key"
                  className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
                />
                <p className="mt-2 text-sm text-gray-500">
                  Virtual key for model routing and configuration. Get from <a href="https://app.portkey.ai" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">app.portkey.ai</a>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Language Section */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Language Settings</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Summary Language
            </label>
            <select
              value={settings.language}
              onChange={(e) => setSettings(prev => ({ ...prev, language: e.target.value as 'chinese' | 'english' }))}
              className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
            >
              <option value="chinese">中文 (Chinese)</option>
              <option value="english">English</option>
            </select>
            <p className="mt-2 text-sm text-gray-500">
              Choose the default language for AI-generated summaries
            </p>
          </div>
        </div>

        {/* Prompt Configuration Section */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Prompt Configuration</h2>
            <button
              onClick={resetPromptsToDefault}
              className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md transition-colors"
            >
              Reset to Default
            </button>
          </div>

          <div className="space-y-4">
            {/* Language Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Configure Prompts for Language
              </label>
              <select
                value={settings.language}
                onChange={(e) => setSettings(prev => ({ ...prev, language: e.target.value as 'chinese' | 'english' }))}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="chinese">中文 (Chinese)</option>
                <option value="english">English</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Select the language to configure prompts for
              </p>
            </div>

            {/* Dynamic Prompt Configuration */}
            <div className="border border-gray-200 rounded-lg p-4 bg-white">
              <h3 className="text-lg font-medium text-gray-900 mb-3">
                {settings.language === 'chinese' ? '中文 (Chinese)' : 'English'} Prompt Configuration
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    System Prompt
                  </label>
                  <textarea
                    value={settings.customPrompts?.[settings.language]?.systemPrompt || ''}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      customPrompts: {
                        chinese: prev.customPrompts?.chinese || {
                          systemPrompt: '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。',
                          userPrompt: '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}',
                          temperature: 0.5,
                          maxTokens: 1000
                        },
                        english: prev.customPrompts?.english || {
                          systemPrompt: 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.',
                          userPrompt: 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}',
                          temperature: 0.5,
                          maxTokens: 1000
                        },
                        [settings.language]: {
                          systemPrompt: e.target.value,
                          userPrompt: prev.customPrompts?.[settings.language]?.userPrompt || (settings.language === 'chinese'
                            ? '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}'
                            : 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}'),
                          temperature: prev.customPrompts?.[settings.language]?.temperature || 0.5,
                          maxTokens: prev.customPrompts?.[settings.language]?.maxTokens || 1000
                        }
                      }
                    }))}
                    rows={3}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    placeholder={`Enter the system prompt for ${settings.language === 'chinese' ? 'Chinese' : 'English'} summaries...`}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This defines the AI assistant's role and behavior for {settings.language === 'chinese' ? 'Chinese' : 'English'} summaries
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    User Prompt Template
                  </label>
                  <textarea
                    value={settings.customPrompts?.[settings.language]?.userPrompt || ''}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      customPrompts: {
                        chinese: prev.customPrompts?.chinese || {
                          systemPrompt: '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。',
                          userPrompt: '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}',
                          temperature: 0.5,
                          maxTokens: 1000
                        },
                        english: prev.customPrompts?.english || {
                          systemPrompt: 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.',
                          userPrompt: 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}',
                          temperature: 0.5,
                          maxTokens: 1000
                        },
                        [settings.language]: {
                          systemPrompt: prev.customPrompts?.[settings.language]?.systemPrompt || (settings.language === 'chinese'
                            ? '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。'
                            : 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.'),
                          userPrompt: e.target.value,
                          temperature: prev.customPrompts?.[settings.language]?.temperature || 0.5,
                          maxTokens: prev.customPrompts?.[settings.language]?.maxTokens || 1000
                        }
                      }
                    }))}
                    rows={3}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    placeholder={`Enter the user prompt template for ${settings.language === 'chinese' ? 'Chinese' : 'English'} summaries...`}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use {'{text}'} as a placeholder for the webpage content
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Temperature
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.customPrompts?.[settings.language]?.temperature || 0.5}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        customPrompts: {
                          chinese: prev.customPrompts?.chinese || {
                            systemPrompt: '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。',
                            userPrompt: '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}',
                            temperature: 0.5,
                            maxTokens: 1000
                          },
                          english: prev.customPrompts?.english || {
                            systemPrompt: 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.',
                            userPrompt: 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}',
                            temperature: 0.5,
                            maxTokens: 1000
                          },
                          [settings.language]: {
                            systemPrompt: prev.customPrompts?.[settings.language]?.systemPrompt || (settings.language === 'chinese'
                              ? '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。'
                              : 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.'),
                            userPrompt: prev.customPrompts?.[settings.language]?.userPrompt || (settings.language === 'chinese'
                              ? '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}'
                              : 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}'),
                            temperature: parseFloat(e.target.value) || 0.5,
                            maxTokens: prev.customPrompts?.[settings.language]?.maxTokens || 1000
                          }
                        }
                      }))}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Controls randomness (0 = deterministic, 2 = very random)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Max Tokens
                    </label>
                    <input
                      type="number"
                      min="100"
                      max="4000"
                      step="100"
                      value={settings.customPrompts?.[settings.language]?.maxTokens || 1000}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        customPrompts: {
                          chinese: prev.customPrompts?.chinese || {
                            systemPrompt: '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。',
                            userPrompt: '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}',
                            temperature: 0.5,
                            maxTokens: 1000
                          },
                          english: prev.customPrompts?.english || {
                            systemPrompt: 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.',
                            userPrompt: 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}',
                            temperature: 0.5,
                            maxTokens: 1000
                          },
                          [settings.language]: {
                            systemPrompt: prev.customPrompts?.[settings.language]?.systemPrompt || (settings.language === 'chinese'
                              ? '你是一个有用的助手，专门总结网页内容。请提供简洁、结构清晰的摘要，突出主要观点和关键信息。'
                              : 'You are a helpful assistant that summarizes web page content. Provide a concise, well-structured summary highlighting the main points and key information.'),
                            userPrompt: prev.customPrompts?.[settings.language]?.userPrompt || (settings.language === 'chinese'
                              ? '请为以下网页内容提供一个简洁、结构清晰的中文摘要，突出主要观点和关键信息：\n\n{text}'
                              : 'Please provide a concise, well-structured summary of this webpage content, highlighting the main points and key information:\n\n{text}'),
                            temperature: prev.customPrompts?.[settings.language]?.temperature || 0.5,
                            maxTokens: parseInt(e.target.value) || 1000
                          }
                        }
                      }))}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Maximum length of the generated summary
                    </p>
                  </div>
                </div>
              </div>
            </div>


          </div>
        </div>

        {/* Behavior Section */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Extension Behavior</h2>

          <div className="flex items-start">
            <div className="flex items-center h-5">
              <input
                id="auto-summarize"
                type="checkbox"
                checked={settings.autoSummarize !== false}
                onChange={(e) => setSettings(prev => ({ ...prev, autoSummarize: e.target.checked }))}
                className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="auto-summarize" className="font-medium text-gray-700">
                Auto-summarize on popup open
              </label>
              <p className="text-gray-500">
                Automatically start summarizing the current page when you click the extension icon
              </p>
            </div>
          </div>
        </div>

        {/* Cache Configuration Section */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Cache Configuration</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Maximum Cache Size
              </label>
              <input
                type="number"
                min="10"
                max="1000"
                value={settings.cacheMaxSize || 100}
                onChange={(e) => setSettings(prev => ({ ...prev, cacheMaxSize: parseInt(e.target.value) || 100 }))}
                className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
              />
              <p className="mt-2 text-sm text-gray-500">
                Number of URLs to cache (10-1000). Older entries are automatically removed.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cache Expiry (days)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={settings.cacheExpiryDays || 1}
                onChange={(e) => setSettings(prev => ({ ...prev, cacheExpiryDays: parseInt(e.target.value) || 1 }))}
                className="block w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-base"
              />
              <p className="mt-2 text-sm text-gray-500">
                How many days to keep cached summaries (1-30). Expired entries are automatically removed.
              </p>
            </div>
          </div>
        </div>

        {/* Cache Management Section */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Cache Statistics</h2>
            <button
              onClick={loadCacheStats}
              disabled={isLoadingCache}
              className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 rounded-md transition-colors"
            >
              {isLoadingCache ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {cacheStats ? (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg border border-gray-200">
                  <div className="text-2xl font-bold text-blue-600">{cacheStats.size}</div>
                  <div className="text-sm text-gray-600">Cached URLs</div>
                </div>
                <div className="bg-white p-4 rounded-lg border border-gray-200">
                  <div className="text-2xl font-bold text-green-600">{cacheStats.totalSizeFormatted}</div>
                  <div className="text-sm text-gray-600">Storage Used</div>
                </div>
              </div>

              {/* Cache Details */}
              {cacheStats.size > 0 && (
                <div className="bg-white p-4 rounded-lg border border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Cache Details</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Oldest entry:</span>
                      <span className="text-gray-900">{cacheStats.oldestEntry}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Newest entry:</span>
                      <span className="text-gray-900">{cacheStats.newestEntry}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Cache limit:</span>
                      <span className="text-gray-900">{settings.cacheMaxSize || 100} URLs</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Expiry:</span>
                      <span className="text-gray-900">{settings.cacheExpiryDays || 1} day{(settings.cacheExpiryDays || 1) > 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Clear Cache Button */}
              {cacheStats.size > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={clearCache}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md text-sm transition-colors"
                  >
                    Clear All Cache
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              {isLoadingCache ? 'Loading cache statistics...' : 'Click Refresh to load cache statistics'}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-6">
          <button
            type="submit"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-md text-base transition-colors"
          >
            Save Settings
          </button>
          <button
            type="button"
            onClick={testApiConnection}
            disabled={isTestingApi}
            className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 font-medium py-3 px-6 rounded-md text-base border border-gray-300 transition-colors"
          >
            {isTestingApi ? 'Testing Connection...' : 'Test API Connection'}
          </button>
        </div>

        {/* Status Message */}
        {status && (
          <div className={`px-4 py-3 rounded-md text-sm whitespace-pre-line ${
            status.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {status.message}
          </div>
        )}
      </form>

      {/* Updates Section */}
      <div className="bg-gray-50 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Updates</h2>

        <div className="space-y-6">
          {/* August 19, 2025 */}
          <div className="border-l-4 border-purple-500 pl-4">
            <h3 className="text-lg font-medium text-gray-900 mb-2">August 19, 2025</h3>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Custom Prompt Configuration:</strong> Added ability to edit default prompts for both Chinese and English summaries</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Prompt Parameters:</strong> Customizable temperature and max tokens for fine-tuning AI responses</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Prompt Preview:</strong> Live preview of how custom prompts will be used with sample text</span>
              </div>
            </div>
          </div>

          {/* August 18, 2025 */}
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="text-lg font-medium text-gray-900 mb-2">August 18, 2025</h3>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Portkey Integration:</strong> Added support for Portkey AI gateway with virtual key configuration</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Enhanced Model Support:</strong> Now supports Claude, OpenAI, and Portkey with unified configuration interface</span>
              </div>
            </div>
          </div>

          {/* August 17, 2025 */}
          <div className="border-l-4 border-gray-400 pl-4">
            <h3 className="text-lg font-medium text-gray-900 mb-2">August 17, 2025</h3>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Cache Configuration:</strong> Added user-configurable cache size limit and expiry days in options page</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Unified Cache Button:</strong> Consolidated cache status and summarize button with color coding (green for cached, blue for fresh)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Options Page:</strong> Added dedicated full-page options interface with comprehensive settings</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Interface Cleanup:</strong> Removed resize functionality, cleaned up legacy CSS files, simplified popup navigation</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Layout Improvements:</strong> Doubled popup width to 800px, fixed horizontal scrollbar issues using Tailwind</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-teal-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Auto-summarization:</strong> Added automatic summarization when plugin opens with proper timing fixes</span>
              </div>
            </div>
          </div>

          {/* August 16, 2025 */}
          <div className="border-l-4 border-gray-400 pl-4">
            <h3 className="text-lg font-medium text-gray-900 mb-2">August 16, 2025</h3>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-gray-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Foundation:</strong> Core extension architecture with React, Tailwind, and cache system</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-gray-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>AI Integration:</strong> Claude and OpenAI API support with intelligent caching</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 bg-gray-500 rounded-full mt-2 flex-shrink-0"></span>
                <span><strong>Multi-language:</strong> Chinese and English summarization support</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Latest version: v1.0.0</span>
            <span>Built with React + Tailwind CSS</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 pt-8 border-t border-gray-200 text-center text-gray-500 text-sm">
        <p>AI Page Summarizer Extension v1.0.0</p>
        <p className="mt-2">
          Need help? Check the extension popup for quick access to settings and features.
        </p>
      </div>
    </div>
  );
};

// Initialize React app
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('options-root');
  if (container) {
    const root = createRoot(container);
    root.render(<Options />);
  }
});