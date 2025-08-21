// Cache module for storing LLM responses by URL

interface CacheEntry {
  url: string;
  language: string;
  response: string;
  timestamp: number;
  provider: string;
}

interface CacheStorage {
  [key: string]: CacheEntry;
}

export class SummaryCache {
  private static readonly STORAGE_KEY = 'summary_cache';
  private static readonly DEFAULT_MAX_CACHE_SIZE = 100; // Default maximum number of cached entries
  private static readonly DEFAULT_CACHE_EXPIRY_DAYS = 1; // Default cache expiry in days

  private static async getSettings(): Promise<{ cacheMaxSize: number; cacheExpiryDays: number }> {
    try {
      const result = await chrome.storage.local.get(['settings']);
      const settings = result.settings || {};
      return {
        cacheMaxSize: settings.cacheMaxSize || this.DEFAULT_MAX_CACHE_SIZE,
        cacheExpiryDays: settings.cacheExpiryDays || this.DEFAULT_CACHE_EXPIRY_DAYS
      };
    } catch (error) {
      console.error('Error loading cache settings:', error);
      return {
        cacheMaxSize: this.DEFAULT_MAX_CACHE_SIZE,
        cacheExpiryDays: this.DEFAULT_CACHE_EXPIRY_DAYS
      };
    }
  }

  /**
   * Create cache key from URL and language
   * @param url The full URL
   * @param language The language preference
   * @returns Cache key in format "url|language"
   */
  private static createCacheKey(url: string, language: string): string {
    return `${url}|${language}`;
  }

  /**
   * Get cached summary for a URL and language
   * @param url The full URL to look up
   * @param language The language preference
   * @returns Cached summary or null if not found/expired
   */
  static async get(url: string, language: string): Promise<string | null> {
    try {
      const cacheKey = this.createCacheKey(url, language);
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);

      const cache: CacheStorage = result[this.STORAGE_KEY] || {};

      const entry = cache[cacheKey];

      if (!entry) {
        return null;
      }

      // Check if cache entry has expired
      const { cacheExpiryDays } = await this.getSettings();
      const now = Date.now();
      const expiryTime = entry.timestamp + (cacheExpiryDays * 24 * 60 * 60 * 1000);

      if (now > expiryTime) {
        // Entry expired, remove it
        await this.remove(url, language);
        return null;
      }

      return entry.response;
    } catch (error) {
      console.error('❌ Error reading from cache:', error);
      return null;
    }
  }

  /**
   * Store summary in cache
   * @param url The full URL as key
   * @param language The language preference
   * @param response The LLM response to cache
   * @param provider The provider used for the response
   */
  static async set(url: string, language: string, response: string, provider: string): Promise<void> {
    try {
      const cacheKey = this.createCacheKey(url, language);
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const cache: CacheStorage = result[this.STORAGE_KEY] || {};

      // Add new entry
      cache[cacheKey] = {
        url,
        language,
        response,
        timestamp: Date.now(),
        provider
      };

      // Check cache size and remove oldest entries if needed
      const { cacheMaxSize } = await this.getSettings();
      const entries = Object.values(cache);
      if (entries.length > cacheMaxSize) {
        // Sort by timestamp and remove oldest entries
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const entriesToRemove = entries.slice(0, entries.length - cacheMaxSize);

        entriesToRemove.forEach(entry => {
          const entryKey = this.createCacheKey(entry.url, entry.language);
          delete cache[entryKey];
        });
      }

      // Save updated cache
      await chrome.storage.local.set({ [this.STORAGE_KEY]: cache });
    } catch (error) {
      console.error('❌ Error writing to cache:', error);
    }
  }

  /**
   * Remove a specific entry from cache
   * @param url The URL to remove from cache
   * @param language The language preference
   */
  static async remove(url: string, language: string): Promise<void> {
    try {
      const cacheKey = this.createCacheKey(url, language);
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const cache: CacheStorage = result[this.STORAGE_KEY] || {};

      delete cache[cacheKey];

      await chrome.storage.local.set({ [this.STORAGE_KEY]: cache });
    } catch (error) {
      console.error('Error removing from cache:', error);
    }
  }

  /**
   * Clear all cache entries
   */
  static async clear(): Promise<void> {
    try {
      await chrome.storage.local.remove([this.STORAGE_KEY]);
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache statistics
   * @returns Object with cache size and other stats
   */
  static async getStats(): Promise<{
    size: number;
    totalBytes: number;
    totalSizeFormatted: string;
    oldestEntry?: string;
    newestEntry?: string;
    entries: Array<{url: string; language: string; timestamp: string; provider: string; sizeBytes: number}>;
  }> {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const cache: CacheStorage = result[this.STORAGE_KEY] || {};

      const entries = Object.values(cache);
      const size = entries.length;

      if (size === 0) {
        return {
          size: 0,
          totalBytes: 0,
          totalSizeFormatted: '0 B',
          entries: []
        };
      }

      // Calculate total size in bytes
      let totalBytes = 0;
      const entryDetails = entries.map(entry => {
        const entrySize = new Blob([JSON.stringify(entry)]).size;
        totalBytes += entrySize;
        return {
          url: entry.url,
          language: entry.language,
          timestamp: new Date(entry.timestamp).toLocaleString(),
          provider: entry.provider,
          sizeBytes: entrySize
        };
      });

      // Format total size in human-readable format
      const totalSizeFormatted = this.formatBytes(totalBytes);

      entries.sort((a, b) => a.timestamp - b.timestamp);
      const oldestEntry = new Date(entries[0].timestamp).toLocaleString();
      const newestEntry = new Date(entries[entries.length - 1].timestamp).toLocaleString();

      return {
        size,
        totalBytes,
        totalSizeFormatted,
        oldestEntry,
        newestEntry,
        entries: entryDetails
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {
        size: 0,
        totalBytes: 0,
        totalSizeFormatted: '0 B',
        entries: []
      };
    }
  }

  /**
   * Format bytes in human-readable format
   * @param bytes Number of bytes
   * @returns Formatted string (e.g., "1.2 KB", "3.4 MB")
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) {
return '0 B';
}

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  /**
   * Check if a URL and language combination is cached and not expired
   * @param url The URL to check
   * @param language The language preference
   * @returns true if cached and valid, false otherwise
   */
  static async has(url: string, language: string): Promise<boolean> {
    const cached = await this.get(url, language);
    return cached !== null;
  }
}