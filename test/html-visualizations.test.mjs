import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  HTML_CSP,
  HTML_SANDBOX,
  HTML_SIZE_METHOD,
  HTML_THEME_METHOD,
  htmlContentHeight,
  htmlDocument,
  htmlLinkRequest,
  withHtmlNonces,
} from "../htmlFrame.ts";
                                                 
import {
  MAX_HTML_BYTES,
  MAX_VISUALIZATIONS,
  allowsHtml,
  discordHtmlAttachmentUrl,
  fetchHtmlAttachment,
  htmlSources,
  isHtmlCodeBlock,
  replaceHtmlCodeBlocks,
} from "../htmlVisualizations.ts";
             
                    
              
              
                      
                                  

const filters              = {
  onlyBots: false,
  allowedUsers: "",
  allowedChannels: "",
  allowedGuilds: "",
};
const message              = {
  id: "1",
  channel_id: "200",
  author: { id: "100", bot: true },
};
const channel = { guild_id: "300", parent_id: "400", isThread: () => true };
const attachmentUrl = "https://cdn.discordapp.com/attachments/1/2/chart.html?ex=signed&hm=hash";
const untrustedUrls = [
  "file:///chart.html",
  "http://cdn.discordapp.com/attachments/1/2/chart.html",
  "https://cdn.discordapp.com.evil.test/attachments/1/2/chart.html",
  "https://evil.test/attachments/1/2/chart.html",
  "https://user:pass@cdn.discordapp.com/attachments/1/2/chart.html",
  "https://cdn.discordapp.com:444/attachments/1/2/chart.html",
  "https://discord.com/api/users/@me",
  "https://cdn.discordapp.com/not-attachments/chart.html",
  "/attachments/1/2/chart.html",
  "not a URL",
];

function fence(html        , marker = "```", language = "html") {
  return `${marker}${language}\n${html}\n${marker}`;
}

test("empty allowlists permit messages, with the bot restriction applied independently", () => {
  assert.equal(allowsHtml(message, undefined, filters), true);
  assert.equal(allowsHtml({ ...message, author: undefined }, undefined, filters), true);
  assert.equal(allowsHtml(message, channel, { ...filters, allowedUsers: " \t\n" }), true);
  for (const author of [undefined, { id: "100" }, { id: "100", bot: false }]) {
    assert.equal(allowsHtml({ ...message, author }, channel, { ...filters, onlyBots: true }), false);
  }
});

test("allowlists match exact IDs with OR semantics and require bots across every list", () => {
  for (const lists of [
    { allowedUsers: "999, 100\n888" },
    { allowedChannels: "200" },
    { allowedChannels: "400" },
    { allowedGuilds: "300" },
    { allowedUsers: "999", allowedChannels: "200", allowedGuilds: "888" },
  ]) {
    const configured = { ...filters, ...lists, onlyBots: true };
    assert.equal(allowsHtml(message, channel, configured), true, JSON.stringify(lists));
    assert.equal(allowsHtml({ ...message, author: { id: "100", bot: false } }, channel, configured), false);
  }
  for (const allowedUsers of ["10", "1000", "invalid", ",,", "999"]) {
    assert.equal(allowsHtml(message, channel, { ...filters, allowedUsers }), false, allowedUsers);
  }
});

test("parent-channel allowlists apply only to threads and missing context never matches", () => {
  const parentOnly = { ...filters, allowedChannels: "400" };
  assert.equal(allowsHtml(message, channel, parentOnly), true);
  assert.equal(allowsHtml(message, { ...channel, isThread: () => false }, parentOnly), false);
  assert.equal(allowsHtml(message, { parent_id: "400" }, parentOnly), false);
  assert.equal(allowsHtml(message, undefined, parentOnly), false);
  assert.equal(allowsHtml(message, undefined, { ...filters, allowedGuilds: "300" }), false);
  assert.equal(allowsHtml({ ...message, author: undefined }, channel, { ...filters, allowedUsers: "100" }), false);
  assert.equal(allowsHtml(message, undefined, { ...filters, allowedChannels: "200" }), true);
});

test("extracts live HTML fences and signed attachments while ignoring nested examples", () => {
  const content = [
    "Example:",
    "````markdown",
    "```html",
    "<p>example only</p>",
    "```",
    "````",
    fence("  <button>Live</button>  ", "```", "html-render"),
    fence("<p>Also live</p>", "~~~", "HTML"),
    fence("const ignored = true;", "```", "js"),
    "```html",
    "<p>unfinished</p>",
  ].join("\n");
  const sources = htmlSources({
    ...message,
    content,
    attachments: [
      { id: "html", filename: "T3 chart.HTML", size: 200, url: attachmentUrl },
      { id: "htm", filename: "another.htm", size: 200, url: attachmentUrl },
      { id: "text", filename: "chart.txt", size: 200, url: attachmentUrl },
    ],
  });
  assert.deepEqual(sources.map((source) => "html" in source ? source.html : source.url), [
    "<button>Live</button>", "<p>Also live</p>", attachmentUrl, attachmentUrl,
  ]);
  assert.equal(sources[2]?.title, "T3 chart.HTML");
  assert.equal(sources[2]?.key, "attachment-html");
  assert.equal(new Set(sources.map((source) => source.key)).size, sources.length);
});

test("unfinished outer examples never promote a nested HTML fence to executable content", () => {
  for (const marker of ["````", "~~~~"]) {
    assert.deepEqual(htmlSources({
      ...message,
      content: `${marker}markdown\n${fence("<p>example only</p>")}`,
    }), []);
  }
});

test("fences allow longer closing markers and ignore incomplete or mismatched closures", () => {
  for (const marker of ["```", "~~~"]) {
    const sources = htmlSources({ ...message, content: `${marker}html\n<p>live</p>\n${marker}${marker[0]}` });
    assert.equal(sources.length, 1);
    assert.equal(sources[0] && "html" in sources[0] ? sources[0].html : undefined, "<p>live</p>");
  }
  for (const content of [
    "```html\n<p>unfinished</p>",
    "````html\n<p>short close</p>\n```",
    "```html\n<p>wrong marker</p>\n~~~",
    fence("  \t  "),
    fence("<p>not HTML</p>", "```", "htmlish"),
    "<p>unfenced</p>",
    "https://t3.example/api/assets/token/chart.html",
  ]) assert.deepEqual(htmlSources({ ...message, content }), [], content);
});

test("the page budget is shared by code and attachments, with code taking precedence", () => {
  const attachments = Array.from({ length: MAX_VISUALIZATIONS + 2 }, (_, index) => ({
    id: String(index), filename: `chart-${index}.html`, size: 1, url: attachmentUrl,
  }));
  const sources = htmlSources({ ...message, content: fence("<p>first</p>"), attachments });
  assert.equal(sources.length, MAX_VISUALIZATIONS);
  assert.equal(sources.filter((source) => "html" in source).length, 1);
  assert.deepEqual(sources.slice(1).map((source) => source.key), ["attachment-0", "attachment-1", "attachment-2"]);
  const codeOnly = htmlSources({ ...message, content: Array.from({ length: 6 }, (_, index) => fence(`<p>${index}</p>`)).join("\n"), attachments });
  assert.equal(codeOnly.length, MAX_VISUALIZATIONS);
  assert.ok(codeOnly.every((source) => "html" in source));
});

test("source and inline limits count UTF-8 bytes and accept the exact byte boundary", () => {
  const atLimit = "é".repeat(MAX_HTML_BYTES / 2);
  const sources = htmlSources({ ...message, content: fence(atLimit) });
  assert.equal(sources.length, 1);
  assert.equal(isHtmlCodeBlock({ lang: "html", content: atLimit }), true);
  assert.equal(htmlSources({ ...message, content: fence(`${atLimit}é`) }).length, 0);
  assert.equal(isHtmlCodeBlock({ lang: "html", content: `${atLimit}é` }), false);
  const attachments = [
    { id: "big", filename: "big.html", size: MAX_HTML_BYTES + 1, url: attachmentUrl },
    { id: "boundary", filename: "boundary.html", size: MAX_HTML_BYTES, url: attachmentUrl },
  ];
  assert.deepEqual(htmlSources({ ...message, attachments }).map((source) => source.key), ["attachment-boundary"]);
});

test("only HTTPS Discord attachment hosts and paths are trusted", () => {
  for (const url of [attachmentUrl, "https://media.discordapp.net/attachments/1/2/chart.htm?signature=kept"]) {
    assert.equal(discordHtmlAttachmentUrl(url), true, url);
  }
  for (const url of untrustedUrls) {
    assert.equal(discordHtmlAttachmentUrl(url), false, url);
    assert.deepEqual(htmlSources({ ...message, attachments: [{ id: "bad", filename: "chart.html", size: 1, url }] }), [], url);
  }
});

test("invalid attachment URLs are rejected before any download", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network access");
  });
  for (const url of untrustedUrls) {
    await assert.rejects(fetchHtmlAttachment(url, new AbortController().signal), /Invalid HTML attachment URL/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("downloads omit credentials, forbid redirects, and decode split UTF-8 streams", async (t) => {
  const html = "<p>café 😀</p>";
  const bytes = new TextEncoder().encode(html);
  let offset = 0;
  const body = new ReadableStream            ({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(offset, ++offset));
    },
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(body));
  const signal = new AbortController().signal;
  assert.equal(await fetchHtmlAttachment(attachmentUrl, signal), html);
  assert.equal(fetch.mock.callCount(), 1);
  const call = fetch.mock.calls[0] ;
  assert.equal(call.arguments[0], attachmentUrl);
  assert.deepEqual(call.arguments[1], { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
});

test("the actual stream limit stops and cancels downloads with missing or false length headers", async (t) => {
  for (const advertisedLength of [undefined, "1"]) {
    let reads = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream            ({
      pull(controller) {
        reads++;
        controller.enqueue(reads <= 25 ? chunk : new Uint8Array(1));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = advertisedLength ? { "content-length": advertisedLength } : undefined;
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response(body, { headers }));
    try {
      await assert.rejects(fetchHtmlAttachment(attachmentUrl, new AbortController().signal), /25 MiB/);
      assert.equal(reads, 26);
      assert.equal(cancelled, true);
    } finally {
      fetch.mock.restore();
    }
  }
});

test("an oversized Content-Length cancels the body without reading it", async (t) => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream            ({
    pull() { reads++; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "content-length": String(MAX_HTML_BYTES + 1) } }));
  await assert.rejects(fetchHtmlAttachment(attachmentUrl, new AbortController().signal), /25 MiB/);
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
});

test("failed HTTP responses, missing bodies, and interrupted streams reject", async (t) => {
  const streamFailure = new Error("stream interrupted");
  const responses = [
    new Response("unavailable", { status: 503 }),
    new Response(null),
    new Response(new ReadableStream({ start(controller) { controller.error(streamFailure); } })),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift() );
  const signal = new AbortController().signal;
  await assert.rejects(fetchHtmlAttachment(attachmentUrl, signal), /503/);
  await assert.rejects(fetchHtmlAttachment(attachmentUrl, signal), /empty/);
  await assert.rejects(fetchHtmlAttachment(attachmentUrl, signal), (error) => error === streamFailure);
});

test("nonce injection preserves comments, quoted attributes, and script/style contents", () => {
  const html = '<!-- <script>comment</script> --><div data-example="<script>attribute</script>"></div><script nonce="old">const example=\'<style>string</style>\';</script><style>body::after{content:"<script>css</script>"}</style>';
  const expected = '<!-- <script>comment</script> --><div data-example="<script>attribute</script>"></div><script nonce="script-key" nonce="old">const example=\'<style>string</style>\';</script><style nonce="style-key">body::after{content:"<script>css</script>"}</style>';
  assert.equal(withHtmlNonces(html, { script: "script-key", style: "style-key" }), expected);
  assert.equal(withHtmlNonces(html, {}), html);
});

test("raw-text elements never turn tag examples into nonce-bearing markup", () => {
  for (const tag of ["textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]) {
    const example = `<${tag}><script>example</script><style>example</style></${tag}>`;
    assert.equal(withHtmlNonces(`${example}<script>live()</script>`, { script: "key", style: "css" }), `${example}<script nonce="key">live()</script>`, tag);
    const unclosed = `<${tag}><script>example</script>`;
    assert.equal(withHtmlNonces(unclosed, { script: "key" }), unclosed, tag);
  }
  const plaintext = "<plaintext><script>example</script><style>example</style>";
  assert.equal(withHtmlNonces(plaintext, { script: "key", style: "css" }), plaintext);
  const comment = "<!-- unfinished <script>example</script>";
  assert.equal(withHtmlNonces(comment, { script: "key" }), comment);
});

test("HTML comment endings and script double-escaped text preserve executable boundaries", () => {
  for (const comment of ["<!-->", "<!-- x --!>"]) {
    assert.equal(withHtmlNonces(`${comment}<script>live()</script>`, { script: "key" }), `${comment}<script nonce="key">live()</script>`);
  }
  const body = 'const s = "<!--<script></script><script>example</script>";';
  assert.equal(withHtmlNonces(`<script>${body}</script><script>live()</script>`, { script: "key" }), `<script nonce="key">${body}</script><script nonce="key">live()</script>`);
});

test("nonce attributes are escaped while mixed-case tags and original attributes survive", () => {
  assert.equal(withHtmlNonces('<ScRiPt data-x=">">run()</ScRiPt><STYLE media="all">p{}</STYLE>', { script: 'a&"<b>', style: "css" }), '<ScRiPt nonce="a&amp;&quot;&lt;b&gt;" data-x=">">run()</ScRiPt><STYLE nonce="css" media="all">p{}</STYLE>');
});

test("resize messages require their JSON-RPC schema and clamp finite positive heights", () => {
  const size = (height         ) => ({ jsonrpc: "2.0", method: HTML_SIZE_METHOD, params: { height } });
  for (const [height, expected] of [[460.1, 461], [1, 80], [80, 80], [2000, 2000], [999999, 2000]]) {
    assert.equal(htmlContentHeight(size(height)), expected);
  }
  for (const height of [NaN, Infinity, -Infinity, 0, -2, "400", null, undefined, true]) assert.equal(htmlContentHeight(size(height)), undefined);
  for (const data of [null, false, "400", [], {}, { ...size(400), jsonrpc: "1.0" }, { ...size(400), method: "ui/open-link" }, { ...size(400), params: null }]) {
    assert.equal(htmlContentHeight(data), undefined);
  }
});

test("link requests accept absolute HTTP URLs and finite numeric or string IDs", () => {
  const request = (url         , id          = "link-1") => ({ jsonrpc: "2.0", id, method: "ui/open-link", params: { url } });
  assert.deepEqual(htmlLinkRequest(request("https://example.com/docs")), { id: "link-1", url: "https://example.com/docs" });
  assert.deepEqual(htmlLinkRequest(request("http://example.com", 0)), { id: 0, url: "http://example.com/" });
  for (const url of ["javascript:alert(1)", "file:///tmp/a", "vencord://settings", "//example.com/docs", "/api/me", "https://user:secret@example.com", "https://example.com/" + "a".repeat(8192), null, 400]) {
    assert.equal(htmlLinkRequest(request(url)), undefined);
  }
  for (const id of [NaN, Infinity, null, undefined, {}, true]) assert.equal(htmlLinkRequest({ ...request("https://example.com"), id }), undefined);
  for (const data of [null, [], {}, { ...request("https://example.com"), jsonrpc: "1.0" }, { ...request("https://example.com"), method: HTML_SIZE_METHOD }, { ...request("https://example.com"), params: null }]) {
    assert.equal(htmlLinkRequest(data), undefined);
  }
});

test("iframe sandbox grants scripts without same-origin, navigation, or popup privileges", () => {
  assert.deepEqual(HTML_SANDBOX.split(/\s+/), ["allow-scripts"]);
  const directives = new Map(HTML_CSP.split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
  for (const name of ["default-src", "connect-src", "frame-src", "object-src", "base-uri", "form-action"]) {
    assert.deepEqual(directives.get(name), ["'none'"], name);
  }
  assert.deepEqual(directives.get("script-src"), ["'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"]);
});

test("generated documents place CSP and nonce-bearing bootstrap before untrusted HTML", () => {
  const authorHtml = '<!doctype html><html><head><base href="https://evil.test/"><script>page()</script></head><body><p>chart</p></body></html>';
  const theme            = { appearance: "dark", variables: { "--foreground": "#fff" } };
  const document = htmlDocument(authorHtml, theme, { script: "script-key", style: "style-key" });
  const policy = `<meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">`;
  assert.ok(document.startsWith(`<!doctype html><html><head><meta charset="utf-8">${policy}`));
  assert.ok(document.indexOf(policy) < document.indexOf('<base href="https://evil.test/">'));
  assert.match(document, /<style nonce="style-key" id="excord-html-theme"><\/style><script nonce="script-key">/);
  assert.ok(document.endsWith(withHtmlNonces(authorHtml, { script: "script-key", style: "style-key" })));
});

test("the bootstrap applies escaped theme data without requiring access to the opaque frame's parent", () => {
  const hostileValue = '</script><script>throw new Error("escaped")</script>';
  const theme            = {
    appearance: "light",
    variables: { "--foreground": "#123456", "--font-sans": "system-ui", "--unsafe": hostileValue, "not-a-token": "ignored" },
  };
  const html = htmlDocument("<p>chart</p>", theme);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  const properties = new Map                ();
  const style = { textContent: "" };
  const rootStyle = { colorScheme: "", setProperty: (key        , value        ) => properties.set(key, value) };
  const parent = new Proxy({}, { get() { throw new Error("Opaque-origin parent access"); } });
  runInNewContext(script, {
    parent,
    document: {
      head: {},
      documentElement: { style: rootStyle },
      getElementById: (id        ) => id === "excord-html-theme" ? style : undefined,
      addEventListener() {},
    },
    MutationObserver: class { observe() {} },
    addEventListener() {},
  }, { timeout: 1000 });
  assert.equal(rootStyle.colorScheme, "light");
  assert.equal(properties.get("--foreground"), "#123456");
  assert.equal(properties.get("--font-sans"), "system-ui");
  assert.equal(properties.get("--unsafe"), hostileValue.replace(/[;{}<>]/g, ""));
  assert.equal(properties.has("not-a-token"), false);
  assert.match(style.textContent, /background:transparent/);
});

test("only nonempty HTML and html-render code blocks are eligible for replacement", () => {
  for (const lang of ["html", "HTML", "html-render", "Html-Render"]) assert.equal(isHtmlCodeBlock({ lang, content: "<p>chart</p>" }), true);
  for (const lang of [undefined, "", "js", "htmlish", "html render", " html"]) assert.equal(isHtmlCodeBlock({ lang, content: "<p>chart</p>" }), false);
  assert.equal(isHtmlCodeBlock({ lang: "html", content: " \n\t" }), false);
});

test("replacement preserves native rendering for other languages and denied HTML", () => {
  const native                    = function (               node, output, state) {
    return JSON.stringify({ native: node.content, output, key: state.key, receiver: this === rule });
  };
  const rule = { react: native };
  const parser = { defaultRules: { codeBlock: rule } };
  const restore = replaceHtmlCodeBlocks(parser, (node, state, fallback) => state.messageId === "allowed" ? `frame:${node.content}` : fallback());
  try {
    assert.equal(rule.react({ lang: "html", content: "<p>chart</p>" }, null, { messageId: "allowed" }), "frame:<p>chart</p>");
    assert.equal(rule.react({ lang: "js", content: "const x=1" }, "output", { key: "js" }), JSON.stringify({ native: "const x=1", output: "output", key: "js", receiver: true }));
    assert.equal(rule.react({ lang: "html", content: "<p>source</p>" }, "output", { messageId: "denied", key: "html" }), JSON.stringify({ native: "<p>source</p>", output: "output", key: "html", receiver: true }));
  } finally { restore(); }
  assert.equal(rule.react, native);
});

test("deferred native fallbacks retain each block's context while Markdown reuses its state", () => {
  const native                    = (node, _output, state) => `${state.channelId}/${state.messageId}/${state.key}:${node.content}`;
  const parser                      = { defaultRules: { codeBlock: { react: native } } };
  const fallbacks                                             = [];
  const restore = replaceHtmlCodeBlocks(parser, (_node, state, fallback) => {
    fallbacks.push(fallback);
    return `frame:${state.key}`;
  });
  try {
    const state = { channelId: "channel-1", messageId: "message-1", key: "first" };
    assert.equal(parser.defaultRules.codeBlock.react({ lang: "html", content: "one" }, null, state), "frame:first");
    state.key = "second";
    assert.equal(parser.defaultRules.codeBlock.react({ lang: "html", content: "two" }, null, state), "frame:second");
    Object.assign(state, { channelId: "channel-2", messageId: "message-2", key: "later" });
    assert.equal(fallbacks[0]?.(), "channel-1/message-1/first:one");
    assert.equal(fallbacks[1]?.(), "channel-1/message-1/second:two");
  } finally { restore(); }
});

test("parser cleanup is repeatable and never overwrites a newer installed renderer", () => {
  const native                    = (node) => `native:${node.content}`;
  const parser                      = { defaultRules: { codeBlock: { react: native } } };
  const restore = replaceHtmlCodeBlocks(parser, () => "frame");
  restore();
  restore();
  assert.equal(parser.defaultRules.codeBlock.react, native);
  const restoreAgain = replaceHtmlCodeBlocks(parser, () => "frame");
  const newer                    = (node) => `newer:${node.content}`;
  parser.defaultRules.codeBlock.react = newer;
  restoreAgain();
  assert.equal(parser.defaultRules.codeBlock.react({ lang: "html", content: "chart" }, null, {}), "newer:chart");
});
