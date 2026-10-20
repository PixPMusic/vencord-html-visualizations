import { afterEach, expect, mock, test } from "bun:test";

import { htmlContentHeight, htmlLinkRequest } from "../src/excord/htmlFrame";
import { allowsHtml, discordHtmlAttachmentUrl, fetchHtmlAttachment, htmlSources, MAX_HTML_BYTES, type HtmlFilters, type HtmlMessage } from "../src/excord/htmlVisualizations";
import { createExcordVisualizationsPlugin } from "../src/excord/visualizations";

const filters: HtmlFilters = { onlyBots: false, allowedUsers: "", allowedChannels: "", allowedGuilds: "" };
const message: HtmlMessage = { id: "1", channel_id: "200", author: { id: "100", bot: true } };
const channel = { guild_id: "300", parent_id: "400", isThread: () => true };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; mock.restore(); });

test("allowlists use exact IDs, OR matching, and the bot restriction applies to every list", () => {
    expect(allowsHtml(message, channel, filters)).toBe(true);
    for (const lists of [{ allowedUsers: "999, 100\n888" }, { allowedChannels: "200" }, { allowedChannels: "400" }, { allowedGuilds: "300" }]) {
        const configured = { ...filters, ...lists, onlyBots: true };
        expect(allowsHtml(message, channel, configured)).toBe(true);
        expect(allowsHtml({ ...message, author: { id: "100", bot: false } }, channel, configured)).toBe(false);
    }
    for (const allowedUsers of ["10", "1000", "invalid", ",,", "999"]) expect(allowsHtml(message, channel, { ...filters, allowedUsers })).toBe(false);
    expect(allowsHtml(message, { ...channel, isThread: () => false }, { ...filters, allowedChannels: "400" })).toBe(false);
    expect(allowsHtml(message, undefined, { ...filters, allowedGuilds: "300" })).toBe(false);
    expect(allowsHtml({ ...message, author: undefined }, channel, { ...filters, onlyBots: true })).toBe(false);
});

test("extracts complete HTML fences and Discord HTML attachments, preserving signed URLs", () => {
    const url = "https://cdn.discordapp.com/attachments/1/2/page.html?ex=signature&hm=hash";
    const sources = htmlSources({ ...message, content: "Example:\n````markdown\n```html\n<p>example only</p>\n```\n````\n```html-render\n<button>Live</button>\n```\n~~~HTML\n<p>Also live</p>\n~~~\n```html\n<p>unfinished</p>", attachments: [
        { id: "file", filename: "T3 chart.html", size: 200, url },
        { id: "other", filename: "page.txt", size: 200, url }
    ] });
    expect(sources.map(source => "html" in source ? source.html : source.url)).toEqual(["<button>Live</button>", "<p>Also live</p>", url]);
    expect(htmlSources({ ...message, content: "<p>unfenced</p>" })).toEqual([]);
    expect(htmlSources({ ...message, content: "https://t3.example/api/assets/token/chart.html" })).toEqual([]);
});

test("caps each page and the number of pages per message", () => {
    const content = Array.from({ length: 6 }, () => "```html\n<p>chart</p>\n```").join("\n");
    expect(htmlSources({ ...message, content })).toHaveLength(4);
    expect(htmlSources({ ...message, content: `\`\`\`html\n${"é".repeat(MAX_HTML_BYTES / 2 + 1)}\n\`\`\`` })).toEqual([]);
    expect(htmlSources({ ...message, attachments: [{ id: "big", filename: "big.html", url: "https://cdn.discordapp.com/attachments/1/2/big.html", size: MAX_HTML_BYTES + 1 }] })).toEqual([]);
});

test("never fetches arbitrary URLs or redirects for HTML attachments", async () => {
    for (const url of ["file:///page.html", "http://cdn.discordapp.com/attachments/1/2/a.html", "https://cdn.discordapp.com.evil.test/attachments/1/2/a.html", "https://user:pass@cdn.discordapp.com/attachments/1/2/a.html", "https://cdn.discordapp.com:444/attachments/a.html", "https://discord.com/api/users/@me", "https://cdn.discordapp.com/not-attachments/a.html"])
        expect(discordHtmlAttachmentUrl(url)).toBe(false);
    const fetchMock = mock(() => Promise.resolve(new Response("<p>loaded</p>")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const signal = new AbortController().signal;
    const url = "https://cdn.discordapp.com/attachments/1/2/a.html";
    expect(await fetchHtmlAttachment(url, signal)).toBe("<p>loaded</p>");
    expect(fetchMock).toHaveBeenCalledWith(url, { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    await expect(fetchHtmlAttachment("https://evil.test/a.html", signal)).rejects.toThrow("Invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("enforces download size against the actual stream, even without Content-Length", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(new Uint8Array(MAX_HTML_BYTES + 1)))) as unknown as typeof fetch;
    await expect(fetchHtmlAttachment("https://cdn.discordapp.com/attachments/1/2/a.html", new AbortController().signal)).rejects.toThrow("25 MiB");
});

test("accepts T3 resize notifications and bounds malicious heights", () => {
    const size = (height: unknown) => ({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height } });
    expect(htmlContentHeight(size(460.1))).toBe(461);
    expect(htmlContentHeight(size(999999))).toBe(2000);
    expect(htmlContentHeight(size(1))).toBe(80);
    for (const value of [NaN, Infinity, -2, "400", null]) expect(htmlContentHeight(size(value))).toBeUndefined();
    expect(htmlContentHeight({ ...size(400), method: "ui/open-link" })).toBeUndefined();
});

test("T3 link requests accept only HTTP destinations and valid request IDs", () => {
    const request = (url: unknown) => ({ jsonrpc: "2.0", id: "link-1", method: "ui/open-link", params: { url } });
    expect(htmlLinkRequest(request("https://example.com/docs"))).toEqual({ id: "link-1", url: "https://example.com/docs" });
    for (const url of ["javascript:alert(1)", "file:///tmp/a", "excord://settings", "/api/me", "https://user:secret@example.com", null])
        expect(htmlLinkRequest(request(url))).toBeUndefined();
    expect(htmlLinkRequest({ ...request("https://example.com"), id: NaN })).toBeUndefined();
});

test("the optional plugin registers before React and stores initialize", () => {
    let definition: Record<string, { default: unknown; multiline?: boolean }> = {};
    const plugin = createExcordVisualizationsPlugin({
        "@api/Settings": { definePluginSettings: (def: typeof definition) => { definition = def; return {}; } },
        "@utils/types": { OptionType: { BOOLEAN: 1, STRING: 2 } },
        "@webpack/common": {}
    });
    expect(plugin.name).toBe("ExcordVisualizations");
    expect(plugin.enabledByDefault).toBe(false);
    expect(definition.onlyBots.default).toBe(true);
    for (const key of ["allowedUsers", "allowedChannels", "allowedGuilds"]) {
        expect(definition[key].default).toBe("");
        expect(definition[key].multiline).toBe(true);
    }
});
