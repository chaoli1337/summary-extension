.PHONY: build clean install

CHROME_EXT_DIR = ~/Library/Application\ Support/Google/Chrome/Default/Extensions
EXT_ID = $(shell ls -1t $(CHROME_EXT_DIR) | head -1)
EXT_VERSION_DIR = $(CHROME_EXT_DIR)/$(EXT_ID)

build:
	npm run build

install: build
	@echo "Installing extension to Chrome..."
	@if [ ! -d "$(CHROME_EXT_DIR)" ]; then \
		echo "Chrome extensions directory not found. Please install manually."; \
		exit 1; \
	fi
	@mkdir -p $(CHROME_EXT_DIR)/ai-page-summarizer
	@cp -r dist/* $(CHROME_EXT_DIR)/ai-page-summarizer/
	@echo "Extension installed. Restart Chrome and enable Developer Mode to see it."

clean:
	npm run clean