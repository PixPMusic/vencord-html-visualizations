# ExcordVisualizations

Enable **ExcordVisualizations** in Discord Settings → Plugins. It is bundled with Excord and disabled by default. It replaces eligible HTML code blocks with interactive visualizations in the same position in the message. Surrounding text and other code blocks stay in place. Uploaded `.html` or `.htm` files render in the attachment area. Once a visualization reports that it has rendered, it replaces its file card, including Discord's source preview. Other attachments stay visible. Files keep their normal cards while loading, if rendering fails, or if filters exclude them. There are no show/hide controls or preview labels.

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
<button id="click">Click me</button>
<script>
document.getElementById("click").onclick = event => {
    event.target.textContent = "Clicked";
};
</script>
```
````

Only complete code blocks render. There is a limit of four attachment previews per message and 25 MiB per document, matching T3's prepared-page size limit. Attachment downloads use the Discord CDN without credentials and stop when the preview unmounts. Arbitrary URLs in message text do not render.

## T3 Code compatibility

T3's `html_render` stores a prepared HTML attachment with inlined local images and a theme bootstrap. Download that `.html` file from T3 and upload it to Discord. A bot can upload the same file bytes. The plugin accepts prepared T3 pages as well as plain HTML. It maps T3's CSS token names to the active Discord/Excord theme, including message backgrounds, text, controls, borders, status colors, chart colors, fonts, and corner radius. The preview inherits the surrounding chat's font, size, weight, line height, spacing, and text color by default. Discord font definitions are copied into the sandbox so gg sans can load there. These defaults and theme tokens follow light/dark mode, scoped themes, and QuickCSS changes without reloading the visualization. The page background is transparent by default, so Discord's message background and hover highlight show through without a separate rectangle. Excord removes the background and fixed typography defaults injected into prepared T3 exports, including after theme changes. Authored backgrounds inside the page and explicit fonts remain intact. T3's exported fallback palette does not replace the host tokens. Authored HTML must use these variables to follow the theme; explicit colors in the document remain authored colors.

The plugin implements the JSON-RPC messages `ui/notifications/host-context-changed`, `ui/notifications/size-changed`, and `ui/open-link`. Link requests open only while the frame has focus and the reader has just interacted with the app. Visualization URLs posted in messages are not preview inputs; send HTML attachments or code blocks.

A T3 tool result containing an `htmlRender.attachmentId` is metadata, not the HTML document. The sender must upload the document itself. The T3 repo's T3Cord bridge currently relays ordinary attachments but does not automatically export `html_render` results. This plugin does not change that bridge or fetch private T3 asset URLs.

The implementation follows the T3 renderer inspected at commit `0534b64`, in `packages/shared/src/htmlRender.ts` and `apps/web/src/components/files/BrowserDocumentFrame.tsx`. Research is in the [T3 repo thread](t3-thread://v1/mcp:651ecbbf-8bb6-4303-bb15-f1c64363a4bb).

## Rendering boundary

Each page runs in an iframe with `sandbox="allow-scripts"`. It has an opaque origin and cannot access Discord's document, storage, native bridge, or Node APIs. The host accepts resize and link messages only from the corresponding frame.

Inline script and style tags receive the host document's nonce so they can run under Discord's inherited content policy. Use script callbacks for interaction; inline event attributes such as `onclick="..."` are blocked by nonce-based policies. Scripts from jsDelivr and cdnjs, Discord fonts, Google Fonts, and HTTPS images are permitted, subject to Discord's inherited content policy. Network API requests, nested frames, forms, popups, downloads, and local filesystem access are blocked. Pages that require other remote libraries or APIs must bundle their dependencies and data. Raw local image paths must be inlined before sending; T3's prepared exports already do this.

## Verification

`bun run check` covers the native attachment hook, inline code replacement and restoration, nonce rewriting, filters, parsing, attachment URL and size validation, T3 message validation, and catalog registration without initialized Discord modules. `bun run build` verifies the bundled runtime. The native Electron smoke test checks that the plugin is off on a fresh profile.

For browser checks, run `bun run scripts/preview-html.mts` and open its printed URL. Add `?nonce=1` to exercise an inherited nonce-based script and style policy. It mounts the actual plugin with synthetic native attachment cards, a code-block rule, prepared T3 theme regeneration, and settings, without a Discord account. It exposes `htmlProbe` for checking filter changes, plugin lifecycle, theme updates, and sandbox reports. This fixture does not verify Discord's current signed-in message layout or target-platform behavior.
