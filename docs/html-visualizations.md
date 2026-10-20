# HTML visualizations

Enable **HtmlVisualizations** in Discord Settings → Plugins. It is bundled with Excord and disabled by default. It adds an interactive preview below HTML code blocks and uploaded `.html` or `.htm` files. The original message and attachment remain available. Use **Hide visualization** to unload a preview.

The settings follow MessageLogger's multiline, comma-separated ID fields:

- **Allowed users** accepts Discord user IDs.
- **Allowed channels** accepts channel IDs, including threads inside listed channels.
- **Allowed guilds** accepts server IDs.
- **Only apply to bots** requires the message author to be a bot. It defaults to on.

A match in any allowlist permits rendering. Leave all three lists empty to allow every location. The bot switch still applies. Copy IDs using Discord's Developer Mode. Changing a filter removes existing previews that no longer match; disabling the plugin unloads all its previews.

## Sending HTML

Send a complete HTML document as a file attachment, or use a fenced code block with the `html` or `html-render` language:

````markdown
```html
<button onclick="this.textContent = 'Clicked'">Click me</button>
```
````

Only complete code blocks render. There is a limit of four previews per message and 25 MiB per document, matching T3's prepared-page size limit. Attachment downloads use the Discord CDN without credentials and stop when the preview unmounts. Arbitrary URLs in message text do not render.

## T3 Code compatibility

T3's `html_render` stores a prepared HTML attachment with inlined local images and a theme bootstrap. Download that `.html` file from T3 and upload it to Discord. A bot can upload the same file bytes. The plugin accepts prepared T3 pages as well as plain HTML. It maps T3's CSS token names to the active Discord/Excord theme, including message backgrounds, text, controls, borders, status colors, chart colors, fonts, and corner radius. These follow light/dark mode, scoped themes, and QuickCSS changes without reloading the visualization. T3's exported fallback palette does not replace the host tokens. Authored HTML must use these variables to follow the theme; explicit colors in the document remain authored colors.

The plugin implements the JSON-RPC messages `ui/notifications/host-context-changed`, `ui/notifications/size-changed`, and `ui/open-link`. Link requests open only while the frame has focus and the reader has just interacted with the app. Visualization URLs posted in messages are not preview inputs; send HTML attachments or code blocks.

A T3 tool result containing an `htmlRender.attachmentId` is metadata, not the HTML document. The sender must upload the document itself. The T3 repo's T3Cord bridge currently relays ordinary attachments but does not automatically export `html_render` results. This plugin does not change that bridge or fetch private T3 asset URLs.

The implementation follows the T3 renderer inspected at commit `0534b64`, in `packages/shared/src/htmlRender.ts` and `apps/web/src/components/files/BrowserDocumentFrame.tsx`. Research is in the [T3 repo thread](t3-thread://v1/mcp:651ecbbf-8bb6-4303-bb15-f1c64363a4bb).

## Rendering boundary

Each page runs in an iframe with `sandbox="allow-scripts"`. It has an opaque origin and cannot access Discord's document, storage, native bridge, or Node APIs. The host accepts resize and link messages only from the corresponding frame.

Inline scripts and styles work. Scripts from jsDelivr and cdnjs, Google Fonts, and HTTPS images are permitted, subject to Discord's inherited content policy. Network API requests, nested frames, forms, popups, downloads, and local filesystem access are blocked. Pages that require other remote libraries or APIs must bundle their dependencies and data. Raw local image paths must be inlined before sending; T3's prepared exports already do this.

## Verification

`bun run check` covers filters, parsing, attachment URL and size validation, T3 message validation, and catalog registration without initialized Discord modules. `bun run build` verifies the bundled runtime. The native Electron smoke test checks that the plugin is off on a fresh profile.

For browser checks, run `bun run scripts/preview-html.mts` and open its printed URL. It mounts the actual plugin with synthetic messages and settings, without a Discord account. It exposes `htmlProbe` for checking filter changes, plugin lifecycle, theme updates, and sandbox reports. This fixture does not verify Discord's current signed-in message layout or target-platform behavior.
