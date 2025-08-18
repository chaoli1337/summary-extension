# Portkey Integration for AI Page Summarizer

## Overview

This document describes the integration of Portkey AI gateway into the AI Page Summarizer Chrome extension, allowing users to use Portkey's unified API for AI model access alongside existing Claude and OpenAI support.

## Implementation Details

### 1. Background Service (`src/background.ts`)

#### New Interface Updates
- Extended `LLMRequest` interface to include `portkey` model type and `virtualKey` field
- Added `callPortkeyAPI()` method using the official Portkey SDK

#### Hybrid Portkey Implementation
```typescript
private async callPortkeyAPI(
  text: string, 
  apiKey: string, 
  apiUrl?: string, 
  virtualKey?: string, 
  language: 'chinese' | 'english' = 'chinese'
): Promise<LLMResponse>
```

**Features:**
- **Primary**: Uses the official [Portkey Node.js SDK](https://portkey.ai/docs/api-reference/sdk/node) when possible
- **Fallback**: Automatically falls back to direct API calls if SDK fails in browser extension context
- Supports custom base URLs for self-hosted instances
- Includes virtual key support for model routing
- Comprehensive error handling with detailed error messages
- Default model: `gpt-4` (can be overridden by virtual key)
- Automatic TypeScript support and type safety
- Browser extension compatibility with graceful degradation

### 2. Options Page (`src/options.tsx`)

#### UI Updates
- Added "Portkey" option to AI Model Provider dropdown
- Dynamic API URL placeholder based on selected model
- Conditional Virtual Key field (only shown for Portkey)
- Updated API key help text to include Portkey App link

#### New Settings Fields
- `model: 'claude' | 'openai' | 'portkey'`
- `virtualKey?: string` - Optional virtual key for model routing

### 3. Popup Component (`src/popup.tsx`)

#### Updates
- Extended Settings interface to include Portkey support
- Updated summarization requests to include virtual key
- Maintains backward compatibility with existing Claude/OpenAI configurations

### 4. Configuration Flow

1. **User selects Portkey** in the AI Model Provider dropdown
2. **API Key field** shows Portkey App link for key acquisition
3. **Virtual Key field** appears (optional) for model routing
4. **API URL field** updates placeholder to Portkey endpoint
5. **Test API** validates Portkey connectivity
6. **Settings are saved** and used for summarization requests

## Hybrid Integration Details

### Primary: Portkey SDK Usage
```typescript
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

  // Create chat completion using SDK
  const response = await portkey.chat.completions.create({
    messages: [...],
    model: 'gpt-4',
    max_tokens: 1000,
    temperature: 0.5
  });
} catch (sdkError) {
  // Fall back to direct API call if SDK fails
  console.log('Portkey SDK failed, falling back to direct API call:', sdkError.message);
  return await this.callPortkeyDirectAPI(text, apiKey, apiUrl, virtualKey, language);
}
```

### Fallback: Direct API Call
```typescript
// Direct API call when SDK fails
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'x-portkey-virtual-key': virtualKey // if provided
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [...],
    max_tokens: 1000,
    temperature: 0.5
  })
});
```

### Error Handling
- **401**: Invalid API key
- **403**: Invalid virtual key or insufficient permissions
- **429**: Rate limit exceeded
- **500+**: Server errors
- **Network errors**: Connection issues

## Usage Instructions

### For End Users

1. **Get Portkey API Key**:
   - Visit [app.portkey.ai](https://app.portkey.ai)
   - Create an account and generate an API key

2. **Configure Extension**:
   - Open extension options
   - Select "Portkey" as AI Model Provider
   - Enter your Portkey API key
   - Optionally enter a Virtual Key for model routing
   - Test the connection
   - Save settings

3. **Use Extension**:
   - Navigate to any webpage
   - Click the extension icon
   - Summarization will use Portkey API

### For Developers

#### Adding New Portkey Features
1. Update `LLMRequest` interface in `background.ts`
2. Add new API call method if needed
3. Update options UI in `options.tsx`
4. Update popup interface in `popup.tsx`
5. Test with Portkey API

#### Testing
```bash
npm run build
# Load extension in Chrome
# Test with Portkey API key and virtual key
```

## Benefits of Hybrid Portkey Integration

1. **Best of Both Worlds**: Uses SDK when possible, falls back to direct API when needed
2. **Browser Extension Compatibility**: Handles Chrome extension service worker limitations gracefully
3. **Official SDK Support**: Leverages the official [Portkey Node.js SDK](https://portkey.ai/docs/api-reference/sdk/node) when available
4. **Type Safety**: Full TypeScript support with automatic type checking
5. **Unified API Gateway**: Single endpoint for multiple AI models
6. **Virtual Key Support**: Model routing and configuration
7. **Cost Management**: Built-in cost tracking and optimization
8. **Fallback Support**: Automatic fallback between models and methods
9. **Custom Endpoints**: Support for self-hosted instances
10. **Robust Error Handling**: Comprehensive error handling with detailed error messages
11. **Graceful Degradation**: Automatically adapts to different environments

## Compatibility

- **Backward Compatible**: Existing Claude/OpenAI configurations continue to work
- **Progressive Enhancement**: Portkey features are optional
- **Graceful Degradation**: Falls back to error handling if Portkey is unavailable

## Future Enhancements

1. **Model Selection**: Allow users to specify which model to use via virtual key
2. **Cost Tracking**: Display Portkey cost information in the UI
3. **Advanced Routing**: Support for complex routing rules
4. **Batch Processing**: Support for multiple model calls
5. **Analytics**: Integration with Portkey's analytics features
