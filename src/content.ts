// Content script to extract text from the current page

interface PageData {
  title: string;
  url: string;
  textContent: string;
  timestamp: number;
}

class PageTextExtractor {
  private static readonly IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'
  ]);

  static extractPageText(): PageData {
    const title = document.title;
    const url = window.location.href;
    const textContent = this.getCleanTextContent();
    const timestamp = Date.now();

    return {
      title,
      url,
      textContent,
      timestamp
    };
  }

  private static getCleanTextContent(): string {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          // Skip invisible elements
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          
          // Skip ignored tags
          if (this.IGNORED_TAGS.has(parent.tagName)) {
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
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractText') {
    try {
      const pageData = PageTextExtractor.extractPageText();
      sendResponse({ success: true, data: pageData });
    } catch (error) {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return true; // Keep message channel open for async response
});

// Auto-extract text when page loads (optional)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Could automatically extract and cache text here
  });
} else {
  // Document already loaded
}