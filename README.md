# chat-export

A browser extension to export chats from web chatbots.


## Supported Sites

- [x] ChatGPT
- [x] DeepSeek
- [ ] Gemini
- [ ] Claude
- [ ] x.AI
- [ ] ...open an issue / PR to request/contribute more sites!

## Features

- Extract message content
- Extract thinking content
- Extract search results
- Extract the current conversation, or list all conversations and choose any one of them.
- Export to JSON
    - Supports standard messages array format with `role`, `content`, keys.
    - Auto-converts content from custom JSON format used by each chat interface into a standardized markdown-renderable text.
    - Copy to JSON
    - Save as JSON
- Export to Markdown
    - Thoughts and Search Results are rendered in a collapsed `<details>` element for easier usage within platforms like Obsidian.
    - Supports converting search citations into the default GFM/Obsidian footnote syntax.
- Download as .ZIP
    - Contains:
        - .md file
        - .json file
        - any images/files in the chat
- Unbolden headings (looks better in Obsidian, and DeepSeek tends to bolden headings).
- Strip HTML tags that aren't in codeblocks
    - Useful if you want to escape like raw `<x>` tags. Because in some cases when they are unclosed they can mess up the entire markdown document view in viewers like Obsidian. (Source: had this happen to me).
- Convert proprietary [ChatGPT citation format](https://developers.openai.com/api/docs/guides/citation-formatting?lang=node.js) back into normal Markdown.