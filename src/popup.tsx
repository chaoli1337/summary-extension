import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import './styles.css';

interface Settings {
  model: 'claude' | 'openai';
  apiKey: string;
  apiUrl?: string;
  language: 'chinese' | 'english';
  cacheMaxSize?: number;
  cacheExpiryDays?: number;
}

interface TabInfo {
  id: number;
  url: string;
  title: string;
}

type TabType = 'current' | 'all-tabs';

const Popup: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null);
  const [settings, setSettings] = useState<Settings>({ 
    model: 'claude', 
    apiKey: '', 
    language: 'chinese' 
  });
  const [summary, setSummary] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [allTabs, setAllTabs] = useState<TabInfo[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{fromCache: boolean; cachedAt?: number} | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  

  useEffect(() => {
    loadSettings();
    loadCurrentTab();
    loadAllTabs();
    loadPersistentState();
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Separate useEffect for auto-summarization that waits for currentTab and settings to be loaded
  useEffect(() => {
    if (currentTab && settings.apiKey && !summary && !error && !isLoading) {
      // Auto-summarize when popup opens and currentTab is available
      const timer = setTimeout(() => {
        summarizeCurrentPage(false); // Allow cache on initial load
      }, 300);
      
      return () => clearTimeout(timer);
    }
  }, [currentTab, settings.apiKey]);

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        setSettings(prev => ({ ...prev, ...result.settings }));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadPersistentState = async () => {
    try {
      const result = await chrome.storage.local.get(['popup_state']);
      const state = result.popup_state;
      if (state && state.requestId) {
        setCurrentRequestId(state.requestId);
        setIsLoading(true);
        startPollingRequest(state.requestId);
      }
    } catch (error) {
      console.error('Error loading persistent state:', error);
    }
  };

  const savePersistentState = async (requestId: string | null, tabUrl?: string) => {
    try {
      await chrome.storage.local.set({
        popup_state: {
          requestId,
          tabUrl: tabUrl || currentTab?.url,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('Error saving persistent state:', error);
    }
  };

  const clearPersistentState = async () => {
    try {
      await chrome.storage.local.remove(['popup_state']);
    } catch (error) {
      console.error('Error clearing persistent state:', error);
    }
  };

  const startPollingRequest = (requestId: string) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await chrome.runtime.sendMessage({
          action: 'getRequestStatus',
          requestId: requestId
        });

        if (status) {
          if (status.status === 'completed' && status.result) {
            setIsLoading(false);
            setSummary(status.result.summary);
            setCacheInfo({
              fromCache: status.result.fromCache || false,
              cachedAt: status.result.cachedAt
            });
            setError('');
            setCurrentRequestId(null);
            clearPersistentState();
            
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          } else if (status.status === 'error') {
            setIsLoading(false);
            setError(status.error || 'Request failed');
            setCurrentRequestId(null);
            clearPersistentState();
            
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
          // If status is 'pending' or 'processing', continue polling
        } else {
          // Request not found, probably expired
          setIsLoading(false);
          setError('Request not found - it may have expired');
          setCurrentRequestId(null);
          clearPersistentState();
          
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('Error polling request status:', error);
      }
    }, 1000); // Poll every second
  };


  const loadCurrentTab = async () => {
    try {
      // Try multiple approaches to find the active tab
      let activeTab = null;
      
      // First try: Get active tab from the current window
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          activeTab = tab;
        }
      } catch (e) {
        console.log('Method 1 failed:', e);
      }
      
      // Second try: Get active tab from any normal window
      if (!activeTab) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, windowType: 'normal' });
          if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
            activeTab = tab;
          }
        } catch (e) {
          console.log('Method 2 failed:', e);
        }
      }
      
      // Third try: Get the last active tab from normal windows
      if (!activeTab) {
        try {
          const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
          for (const window of windows) {
            if (window.tabs) {
              const tab = window.tabs.find(t => t.active && t.url && 
                !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
              if (tab) {
                activeTab = tab;
                break;
              }
            }
          }
        } catch (e) {
          console.log('Method 3 failed:', e);
        }
      }
      
      // Fourth try: Get any valid tab if still no active tab found
      if (!activeTab) {
        try {
          const tabs = await chrome.tabs.query({});
          activeTab = tabs.find(tab => tab.url && 
            !tab.url.startsWith('chrome://') && 
            !tab.url.startsWith('chrome-extension://') &&
            !tab.url.startsWith('moz-extension://'));
        } catch (e) {
          console.log('Method 4 failed:', e);
        }
      }
      
      console.log('Active tab found:', activeTab);
      setCurrentTab(activeTab || null);
    } catch (error) {
      console.error('Error loading current tab:', error);
    }
  };

  const loadAllTabs = async () => {
    try {
      const tabs = await chrome.runtime.sendMessage({ action: 'getAllTabs' });
      setAllTabs(tabs);
    } catch (error) {
      console.error('Error loading tabs:', error);
    }
  };

  const summarizeCurrentPage = async (forceFresh: boolean = false) => {
    // Refresh current tab info before attempting summarization
    await loadCurrentTab();
    
    if (!currentTab || !currentTab.id) {
      setError('No suitable tab found. Please navigate to a webpage and try again.');
      return;
    }

    // Check if the tab URL is valid for summarization
    if (!currentTab.url || 
        currentTab.url.startsWith('chrome://') || 
        currentTab.url.startsWith('chrome-extension://') ||
        currentTab.url.startsWith('moz-extension://')) {
      setError('Cannot summarize this page. Please navigate to a regular webpage.');
      return;
    }

    if (!settings.apiKey) {
      setError('Please configure your API key in the Options page. Click Settings above.');
      return;
    }

    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setIsLoading(true);
    setError('');
    setSummary('');
    setCacheInfo(null);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'extractTabText',
        tabId: currentTab.id
      });

      if (!response || response.length === 0) {
        throw new Error('Could not extract text from the page. The page might be empty or blocked.');
      }

      if (response.length < 50) {
        throw new Error('Page content is too short to summarize meaningfully.');
      }

      // Start async summarization
      const startResponse = await chrome.runtime.sendMessage({
        action: 'startSummarize',
        url: currentTab.url,
        forceFresh: forceFresh,
        data: {
          text: response,
          model: settings.model,
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          language: settings.language
        }
      });

      if (startResponse.error) {
        throw new Error(startResponse.error);
      }

      const requestId = startResponse.requestId;
      setCurrentRequestId(requestId);
      
      // Save state for persistence
      await savePersistentState(requestId, currentTab.url);
      
      // Start polling for results
      startPollingRequest(requestId);

    } catch (error) {
      console.error('Summarization error:', error);
      setError(error instanceof Error ? error.message : 'Summarization failed');
      setIsLoading(false);
      clearPersistentState();
    }
  };


  const openDetachedWindow = async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'openDetachedWindow' });
      window.close();
    } catch (error) {
      console.error('Error opening detached window:', error);
    }
  };

  const focusTab = async (tabId: number) => {
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (error) {
      console.error('Error focusing tab:', error);
    }
  };



  const renderSummary = () => {
    if (!summary) return null;

    try {
      const htmlContent = marked.parse(summary) as string;
      return (
        <div 
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      );
    } catch (error) {
      console.error('Markdown parsing error:', error);
      return <div className="whitespace-pre-wrap">{summary}</div>;
    }
  };

  const formatCacheTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div className="w-[800px] min-w-[700px] max-w-[800px] min-h-[500px] bg-white flex flex-col overflow-hidden box-border">
      {/* Header */}
      <div className="border-b border-gray-200 pb-3 mb-3 px-4 box-border">
        <h1 className="text-lg font-semibold text-blue-600 m-0">AI Page Summarizer</h1>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-gray-200 mb-3 px-4 box-border">
        <nav className="flex justify-between items-center -mb-px">
          <div className="flex space-x-0">
            <button
              className={`tab-button ${activeTab === 'current' ? 'active' : ''}`}
              onClick={() => setActiveTab('current')}
            >
              Current Page
            </button>
            <button
              className={`tab-button ${activeTab === 'all-tabs' ? 'active' : ''}`}
              onClick={() => setActiveTab('all-tabs')}
            >
              All Tabs
            </button>
          </div>
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-50"
            title="Open Settings"
          >
            ⚙️
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="flex-1 flex flex-col min-h-0 px-4 box-border overflow-hidden">
        {/* Current Page Tab */}
        {activeTab === 'current' && (
          <div className="flex flex-col h-full space-y-3">
            {/* Page Info Card */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex justify-between items-start">
                <div className="flex-1 mr-2 min-w-0 overflow-hidden">
                  <h2 className="text-sm font-medium text-gray-900 truncate mb-1">
                    {currentTab?.title || 'Loading...'}
                  </h2>
                  <p className="text-xs text-gray-500 truncate">
                    {currentTab?.url || ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={loadCurrentTab}
                    className="p-1.5 text-gray-400 hover:text-gray-600 border border-gray-300 rounded text-xs"
                    title="Refresh current tab"
                  >
                    ⟳
                  </button>
                  <button
                    onClick={openDetachedWindow}
                    className="p-1.5 text-blue-500 hover:text-blue-700 border border-blue-300 rounded text-xs"
                    title="Open in detached window"
                  >
                    ↗
                  </button>
                </div>
              </div>
            </div>

            {/* Action Controls */}
            <div className="flex gap-2 items-end">
              <div className="flex-shrink-0">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Language
                </label>
                <select
                  value={settings.language}
                  onChange={(e) => setSettings(prev => ({ ...prev, language: e.target.value as 'chinese' | 'english' }))}
                  className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="chinese">中文</option>
                  <option value="english">English</option>
                </select>
              </div>
              
              <div className="flex-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (isLoading && currentRequestId) {
                        // Cancel current request
                        if (pollIntervalRef.current) {
                          clearInterval(pollIntervalRef.current);
                          pollIntervalRef.current = null;
                        }
                        setIsLoading(false);
                        setCurrentRequestId(null);
                        clearPersistentState();
                        setError('Request cancelled');
                      } else if (summary) {
                        // If summary exists, force fresh fetch
                        summarizeCurrentPage(true);
                      } else {
                        // If no summary, allow cache
                        summarizeCurrentPage(false);
                      }
                    }}
                    className={`flex-1 font-medium py-2 px-4 rounded-md text-sm transition-colors h-10 flex items-center justify-center gap-2 ${
                      isLoading 
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : summary 
                          ? cacheInfo?.fromCache
                            ? 'bg-green-600 hover:bg-green-700 text-white border-2 border-green-500'
                            : 'bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-500'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <span>✕</span>
                        <span>Cancel</span>
                      </>
                    ) : summary ? (
                      cacheInfo?.fromCache && cacheInfo.cachedAt ? (
                        <>
                          <span className="w-2 h-2 bg-green-200 rounded-full"></span>
                          <span>Cached {formatCacheTime(cacheInfo.cachedAt)}, click to re-fetch</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 bg-blue-200 rounded-full"></span>
                          <span>Fetched now (cached), click to re-fetch</span>
                        </>
                      )
                    ) : (
                      'Summarize Page'
                    )}
                  </button>
                  {isLoading && (
                    <div className="flex items-center justify-center px-3 bg-blue-50 rounded-md">
                      <span className="inline-block animate-spin text-blue-600">⟳</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Summary Result */}
            {summary && (
              <div className="flex-1 bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col min-h-0">
                <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 rounded-t-lg">
                  <h3 className="text-sm font-medium text-gray-900 m-0">Summary</h3>
                </div>
                <div className="flex-1 p-3 overflow-y-auto min-h-0">
                  {renderSummary()}
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
                {error}
              </div>
            )}
          </div>
        )}

        {/* All Tabs Tab */}
        {activeTab === 'all-tabs' && (
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-medium text-gray-900 m-0">All Tabs</h2>
              <button
                onClick={loadAllTabs}
                className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {allTabs.length === 0 ? (
                <div className="text-center text-gray-500 text-sm">Loading tabs...</div>
              ) : (
                allTabs.map(tab => (
                  <div
                    key={tab.id}
                    onClick={() => focusTab(tab.id)}
                    className="border border-gray-200 rounded-lg p-3 cursor-pointer hover:bg-gray-50 hover:border-blue-300 transition-colors"
                  >
                    <h4 className="text-sm font-medium text-gray-900 mb-1 truncate">
                      {tab.title}
                    </h4>
                    <p className="text-xs text-gray-500 truncate">
                      {tab.url}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>

    </div>
  );
};

// Initialize React app
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<Popup />);
  }
});