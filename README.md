# AI Page Summarizer Chrome Extension

A Chrome extension that extracts text from web pages and generates AI-powered summaries using Claude or OpenAI models. Built with React, TypeScript, and Tailwind CSS.

## Features

### 🤖 AI-Powered Summarization
- **Multiple AI Models**: Support for Anthropic Claude and OpenAI GPT-4
- **Language Support**: Generate summaries in Chinese (中文) or English
- **Smart Caching**: Automatic caching of summaries by URL to avoid redundant API calls
- **API Flexibility**: Use direct Anthropic API or OpenRouter for model access

### 📄 Content Extraction
- **Intelligent Text Extraction**: Extracts clean text content from web pages
- **Multiple Tab Support**: View and manage all open browser tabs
- **Tab Switching**: Click any tab in the list to focus it
- **Current Page Focus**: Automatically detects and works with the active tab

### 🎨 Modern UI
- **React-Based Interface**: Modern component architecture with hooks
- **Tailwind CSS Styling**: Fast, utility-first CSS framework
- **Responsive Design**: Adapts to different popup window sizes
- **Resizable Window**: Drag the bottom-right corner to resize the popup
- **Clean Typography**: Markdown support for formatted summaries

### ⚙️ Configuration
- **Settings Persistence**: Saves API keys and preferences securely
- **API Testing**: Built-in connection testing for troubleshooting
- **Multiple Endpoints**: Support for custom API URLs
- **Detached Window**: Open popup in a separate window for better workflow

## Technical Architecture

### Frontend Stack
- **React 18** with TypeScript for component-based UI
- **Tailwind CSS** for utility-first styling
- **Webpack 5** for bundling and asset management
- **Marked.js** for Markdown parsing and rendering

### Chrome Extension APIs
- **Manifest V3** compliance for modern Chrome extensions
- **Background Service Worker** for API calls and tab management
- **Content Scripts** for text extraction from web pages
- **Chrome Storage API** for settings and cache persistence
- **Chrome Tabs API** for tab information and management

### Code Organization
```
src/
├── popup.tsx          # React popup UI component
├── background.ts      # Service worker for API calls and caching
├── content.ts         # Content script for text extraction
├── cache.ts          # Summary caching system
├── styles.css        # Tailwind CSS with custom components
├── popup.html        # React mount point
└── bootstrap.min.css # Legacy Bootstrap (to be removed)
```

## Installation & Development

### Prerequisites
- Node.js 16+ and npm
- Chrome browser for testing

### Setup
```bash
# Install dependencies
npm install

# Development build with watch mode
npm run dev

# Production build
npm run build

# Clean build artifacts
npm run clean
```

### Loading in Chrome
1. Run `npm run build` to create the `dist/` folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the `dist/` folder
5. The extension will appear in your Chrome toolbar

## Usage

### Basic Workflow
1. **Navigate** to any webpage you want to summarize
2. **Click** the extension icon in Chrome toolbar
3. **Select** your preferred language (Chinese/English)
4. **Click** "Summarize Page" to generate an AI summary
5. **View** the formatted summary with markdown support

### Configuration
1. Go to the **Settings** tab in the popup
2. Choose your AI model (Claude or OpenAI)
3. Enter your API key:
   - **Claude**: Get from [Anthropic Console](https://console.anthropic.com/)
   - **OpenAI**: Get from [OpenRouter](https://openrouter.ai/) (recommended)
4. Optionally set a custom API URL
5. Click **Test API** to verify connectivity
6. Click **Save Settings** to persist configuration

### Advanced Features
- **Tab Management**: Use "All Tabs" to see and switch between open tabs
- **Detached Window**: Click the ↗ button to open popup in a separate window
- **Resize**: Drag the bottom-right corner to resize the popup window
- **Caching**: Summaries are automatically cached for 7 days to save API costs

## API Integration

### Supported Models
- **Claude**: Direct integration with Anthropic's API
- **OpenAI GPT-4**: Via OpenRouter or direct OpenAI API

### Caching Strategy
- Summaries cached by URL for 7 days
- Automatic cache cleanup (max 100 entries)
- Cache bypass for API testing

### Error Handling
- Comprehensive error messages with troubleshooting tips
- Network connectivity detection
- API rate limiting and quota handling
- Graceful fallbacks for failed requests

## Security & Privacy

### Data Handling
- **Local Storage**: API keys stored locally in Chrome storage
- **No Data Collection**: Extension doesn't send data to our servers
- **User Control**: All API calls go directly to your chosen provider
- **Secure Communication**: HTTPS-only API communications

### Permissions
- `activeTab`: Read current webpage content
- `tabs`: List and switch between browser tabs  
- `storage`: Save settings and cache summaries locally
- `scripting`: Inject content scripts for text extraction
- `host_permissions`: Access all websites for content extraction

## Development Notes

### Recent Architecture Changes
- **Migrated from Vanilla JS/Bootstrap to React/Tailwind** for better maintainability
- **Preserved all original functionality** while improving code organization
- **Modern React patterns** with functional components and hooks
- **Type-safe development** with comprehensive TypeScript interfaces

### Build Configuration
- **Webpack 5** with optimized production builds
- **PostCSS** for Tailwind processing and autoprefixing
- **TypeScript compilation** with JSX support
- **Asset copying** for icons and manifest files

## Wishlist
- [x] **Better Caching** make caching expire with dynamic detection
- **No API key use** figure out how to do summary without API keys
- [x]**get the summary right away** do not wait for user to click the button, just start fetching the summary
- **configurable key and model** make model selection and secrets managed by some other tooling instead of browser local storage
- **model and version selection** want to use other models?
- **implement openrouter** implement open router interface
- **read pdf** adding reading from pdf functionality
- **chat interface** implement add chat interface
- **iterate through pages and summarize discussion** reading through all comments 
- **agentic flow** make sure page click through the end, or scoll to the full content
- [x] **keep it alive** have background thread running even if lose focus

## Contributing

The extension is designed to be easily extensible:
- Add new AI models by extending the `LLMRequest` interface
- Customize styling with Tailwind utility classes
- Add new features as React components with TypeScript support

## License

MIT License - See source code for full details.