/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const HTML_SANDBOX = "allow-scripts";
export const HTML_SIZE_METHOD = "ui/notifications/size-changed";
export const HTML_THEME_METHOD = "ui/notifications/host-context-changed";

// srcdoc also inherits Discord's policy. This policy can only tighten it.
export const HTML_CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; img-src data: blob: https:; font-src data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export interface HtmlTheme {
  appearance: "light" | "dark";
  variables: Record<string, string>;
  fontFaces?: string;
  fonts?: { family: string; data: string; descriptors: FontFaceDescriptors }[];
}

// Font faces are scoped to a document. Copy the chat font's definitions so gg sans
// resolves inside the sandbox too, preserving relative URLs from Discord's CSS.
function readChatFontFaces(fontFamily: string) {
  const normalize = (family: string) =>
    family
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase();
  const families = new Set(fontFamily.split(",").map(normalize));
  const faces = new Set<string>();
  const visited = new Set<CSSStyleSheet>();
  function visit(sheet: CSSStyleSheet) {
    if (visited.has(sheet) || sheet.disabled) return;
    visited.add(sheet);
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSImportRule && rule.styleSheet)
          visit(rule.styleSheet);
        if (
          !(rule instanceof CSSFontFaceRule) ||
          !families.has(normalize(rule.style.getPropertyValue("font-family")))
        )
          continue;
        faces.add(
          rule.cssText.replace(
            /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,
            (_match, _quote, url: string) => {
              try {
                return `url(${JSON.stringify(new URL(url, sheet.href || document.baseURI).href)})`;
              } catch {
                return 'url("")';
              }
            },
          ),
        );
      }
    } catch {
      /* Cross-origin theme sheets cannot be inspected. */
    }
  }
  for (const sheet of document.styleSheets) visit(sheet);
  for (const sheet of document.adoptedStyleSheets) visit(sheet);
  return [...faces].join("\n");
}

const fontData = new Map<string, Promise<string>>();

// Discord fonts do not allow CORS from an opaque origin. Read only public font
// assets through the host, cache them, and embed their bytes in the isolated page.
export async function embedHtmlFonts(theme: HtmlTheme): Promise<HtmlTheme> {
  const css = theme.fontFaces || "";
  const urls = [
    ...new Set([...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]!)),
  ];
  const embedded = new Map<string, string>();
  await Promise.all(
    urls.map(async (value) => {
      const url = new URL(value, document.baseURI);
      if (
        !/^https:$/.test(url.protocol) ||
        !["discord.com", "canary.discord.com", "ptb.discord.com"].includes(
          url.hostname,
        ) ||
        !/^\/assets\/[\w-]+\.(?:woff2?|ttf|otf)$/.test(url.pathname) ||
        url.port ||
        url.username ||
        url.password ||
        url.search
      )
        return;
      let promise = fontData.get(url.href);
      if (!promise) {
        promise = fetch(url.href, {
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        }).then(async (response) => {
          if (!response.ok) throw new Error("Chat font unavailable");
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 2 * 1024 * 1024)
            throw new Error("Chat font too large");
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(new Blob([bytes], { type: "font/woff2" }));
          });
        });
        fontData.set(url.href, promise);
      }
      try {
        embedded.set(value, await promise);
      } catch {
        fontData.delete(url.href);
      }
    }),
  );
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const fonts: NonNullable<HtmlTheme["fonts"]> = [];
  const remaining: string[] = [];
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSFontFaceRule)) continue;
    const data = [...rule.cssText.matchAll(/url\("([^"]+)"\)/g)]
      .map((match) => embedded.get(match[1]!))
      .find(Boolean);
    if (!data) {
      remaining.push(rule.cssText);
      continue;
    }
    const { style } = rule;
    fonts.push({
      family: style.getPropertyValue("font-family").replace(/^["']|["']$/g, ""),
      data: data.slice(data.indexOf(",") + 1),
      descriptors: {
        weight: style.getPropertyValue("font-weight") || "normal",
        style: style.getPropertyValue("font-style") || "normal",
        stretch: style.getPropertyValue("font-stretch") || "normal",
        unicodeRange: style.getPropertyValue("unicode-range") || "U+0-10FFFF",
        display: "swap",
      },
    });
  }
  return { ...theme, fontFaces: remaining.join("\n"), fonts };
}

export function readHtmlTheme(
  element: Element = document.documentElement,
): HtmlTheme {
  const style = getComputedStyle(element);
  const token = (names: string[], fallback: string) => {
    for (const name of names) {
      const value = style.getPropertyValue(name).trim();
      if (value) return value;
    }
    return fallback;
  };
  const scope = element.closest(
    ".theme-light, .theme-dark, .theme-darker, .theme-midnight",
  );
  const appearance = (
    scope
      ? scope.classList.contains("theme-light")
      : style.colorScheme === "light"
  )
    ? "light"
    : "dark";
  const light = appearance === "light";
  // Resolve Discord's current semantic tokens where the message is mounted.
  // Legacy names keep older clients and QuickCSS themes working.
  const background = token(
    ["--background-base-lower", "--background-primary"],
    light ? "#ffffff" : "#313338",
  );
  const foreground =
    style.color ||
    token(["--text-default", "--text-normal"], light ? "#313338" : "#dbdee1");
  const surface = token(
    ["--background-surface-high", "--background-secondary"],
    light ? "#f2f3f5" : "#2b2d31",
  );
  const accent = token(
    ["--excord-accent", "--brand-500", "--brand-experiment"],
    "#5865f2",
  );
  const positive = token(
    ["--text-feedback-positive", "--status-positive", "--text-positive"],
    light ? "#16863c" : "#57f287",
  );
  const warning = token(
    ["--text-feedback-warning", "--status-warning"],
    light ? "#926900" : "#fee75c",
  );
  const critical = token(
    ["--text-feedback-critical", "--status-danger", "--text-danger"],
    "#ed4245",
  );
  const info = token(
    ["--text-feedback-info", "--text-link"],
    light ? "#0969da" : "#58a6ff",
  );
  const variables: Record<string, string> = {
    "--background": background,
    "--foreground": foreground,
    "--muted": surface,
    "--muted-foreground": token(
      ["--text-muted"],
      light ? "#5c5e66" : "#949ba4",
    ),
    "--card": surface,
    "--card-foreground": foreground,
    "--popover": token(
      ["--background-surface-higher", "--background-floating"],
      surface,
    ),
    "--popover-foreground": foreground,
    "--secondary": token(["--control-secondary-background-default"], surface),
    "--secondary-foreground": token(
      ["--control-secondary-text-default"],
      foreground,
    ),
    "--border": token(
      ["--border-subtle", "--background-modifier-accent"],
      light ? "#d3d5d9" : "#4e5058",
    ),
    "--input": token(
      ["--input-background-default", "--input-background"],
      surface,
    ),
    "--ring": token(["--border-focus", "--focus-primary"], accent),
    "--primary": token(["--control-primary-background-default"], accent),
    "--primary-foreground": token(
      ["--control-primary-text-default"],
      "#ffffff",
    ),
    "--accent": accent,
    "--accent-foreground": token(["--control-primary-text-default"], "#ffffff"),
    "--accent-surface": token(
      ["--background-brand", "--background-modifier-selected"],
      surface,
    ),
    "--accent-surface-foreground": foreground,
    "--destructive": critical,
    "--destructive-foreground": token(
      ["--control-critical-primary-text-default"],
      "#ffffff",
    ),
    "--destructive-surface": token(
      ["--background-feedback-critical", "--status-danger-background"],
      surface,
    ),
    "--warning": warning,
    "--warning-foreground": background,
    "--warning-surface": token(
      ["--background-feedback-warning", "--status-warning-background"],
      surface,
    ),
    "--success": positive,
    "--success-foreground": background,
    "--info": info,
    "--info-foreground": background,
    "--code-background": token(
      ["--background-base-lowest", "--background-secondary-alt"],
      surface,
    ),
    "--code-foreground": foreground,
    "--radius": token(["--radius-md"], "8px"),
    "--font-sans":
      style.fontFamily || token(["--font-primary"], "system-ui, sans-serif"),
    "--font-mono": token(["--font-code"], "monospace"),
    "--chat-font-size": style.fontSize || "16px",
    "--chat-font-weight": style.fontWeight || "400",
    "--chat-font-style": style.fontStyle || "normal",
    "--chat-line-height": style.lineHeight || "normal",
    "--chat-letter-spacing": style.letterSpacing || "normal",
  };
  [
    accent,
    info,
    token(["--text-brand"], accent),
    warning,
    positive,
    critical,
  ].forEach((value, index) => {
    variables[`--chart-${index + 1}`] = value;
  });
  return {
    appearance,
    variables,
    fontFaces: readChatFontFaces(variables["--font-sans"]!),
  };
}

export function htmlThemeMessage(theme: HtmlTheme) {
  return {
    jsonrpc: "2.0",
    method: HTML_THEME_METHOD,
    params: {
      theme: theme.appearance,
      styles: {
        variables: theme.variables,
        fontFaces: theme.fontFaces,
        fonts: theme.fonts,
      },
    },
  };
}

export function htmlContentHeight(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return;
  const message = data as {
    jsonrpc?: unknown;
    method?: unknown;
    params?: { height?: unknown };
  };
  const height = message.params?.height;
  if (
    message.jsonrpc === "2.0" &&
    message.method === HTML_SIZE_METHOD &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
  )
    return Math.max(80, Math.min(2000, Math.ceil(height)));
}

export function htmlLinkRequest(
  data: unknown,
): { id: string | number; url: string } | undefined {
  if (!data || typeof data !== "object") return;
  const request = data as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: { url?: unknown };
  };
  const value = request.params?.url;
  if (
    request.jsonrpc !== "2.0" ||
    request.method !== "ui/open-link" ||
    typeof value !== "string" ||
    value.length > 8192 ||
    !(
      typeof request.id === "string" ||
      (typeof request.id === "number" && Number.isFinite(request.id))
    )
  )
    return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return { id: request.id, url: url.href };
  } catch {
    return;
  }
}

export function readHtmlNonces() {
  const script =
    document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || "";
  const style =
    document.querySelector<HTMLStyleElement>("style[nonce]")?.nonce || script;
  return { script, style };
}

function isHtmlSpace(character: string | undefined) {
  return character !== undefined && /[\t\n\f\r ]/.test(character);
}

function isHtmlTagBoundary(character: string | undefined) {
  return character === "/" || character === ">" || isHtmlSpace(character);
}

// Quotes only open attribute values after '='; quotes in names or unquoted
// values are ordinary characters, even in malformed HTML.
function htmlTagEnd(html: string, index: number) {
  let state: "before-name" | "name" | "after-name" | "before-value" | "unquoted" =
    "before-name";
  let quote = "";
  for (; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) {
        quote = "";
        state = "before-name";
      }
      continue;
    }
    if (character === ">") return index + 1;
    if (state === "before-value") {
      if (isHtmlSpace(character)) continue;
      if (character === '"' || character === "'") quote = character;
      else state = "unquoted";
    } else if (state === "unquoted") {
      if (isHtmlSpace(character)) state = "before-name";
    } else if (isHtmlSpace(character)) {
      if (state === "name") state = "after-name";
    } else if (character === "/") {
      state = "before-name";
    } else if (character === "=" && state !== "before-name") {
      state = "before-value";
    } else {
      state = "name";
    }
  }
  return -1;
}

function htmlCommentEnd(html: string, index: number) {
  // Empty comments can end before the usual '-->' / '--!>' terminator.
  if (html[index] === ">") return index + 1;
  if (html[index] === "-" && html[index + 1] === ">") return index + 2;
  for (; index < html.length; index++) {
    if (html[index] !== "-" || html[index + 1] !== "-") continue;
    if (html[index + 2] === ">") return index + 3;
    if (html[index + 2] === "!" && html[index + 3] === ">") return index + 4;
  }
  return html.length;
}

function htmlRawTextEnd(html: string, index: number, tag: string) {
  let scriptState: "data" | "escaped" | "double-escaped" = "data";
  let dashes = 0;
  for (; index < html.length; index++) {
    const character = html[index];
    if (character === "<") {
      dashes = 0;
      const endName = index + 2 + tag.length;
      const isEndTag =
        html[index + 1] === "/" &&
        html.slice(index + 2, endName).toLowerCase() === tag &&
        isHtmlTagBoundary(html[endName]);
      if (isEndTag && scriptState !== "double-escaped") {
        const end = htmlTagEnd(html, endName);
        return end === -1 ? html.length : end;
      }
      if (tag !== "script") continue;
      if (scriptState === "double-escaped") {
        if (isEndTag) {
          scriptState = "escaped";
          index = endName;
        }
      } else if (scriptState === "escaped") {
        const startName = index + 1 + tag.length;
        if (
          html.slice(index + 1, startName).toLowerCase() === tag &&
          isHtmlTagBoundary(html[startName])
        ) {
          scriptState = "double-escaped";
          index = startName;
        }
      } else if (html.startsWith("<!--", index)) {
        scriptState = "escaped";
        dashes = 2;
        index += 3;
      }
    } else if (scriptState !== "data") {
      if (character === "-") dashes = Math.min(dashes + 1, 2);
      else {
        // '-->' exits both escaped script states, including double-escaped.
        if (character === ">" && dashes === 2) scriptState = "data";
        dashes = 0;
      }
    }
  }
  return html.length;
}

// Read only tags, skipping comments and raw text contents. Never parse HTML
// in the host document, where image and frame requests could run outside the sandbox.
export function withHtmlNonces(
  html: string,
  nonces: { script?: string; style?: string },
) {
  const result: string[] = [];
  let last = 0;
  let index = 0;
  while ((index = html.indexOf("<", index)) !== -1) {
    if (html.startsWith("<!--", index)) {
      index = htmlCommentEnd(html, index + 4);
      continue;
    }
    const closing = html[index + 1] === "/";
    const nameStart = index + (closing ? 2 : 1);
    if (!/[a-z]/i.test(html[nameStart] || "")) {
      // Declarations and invalid end tags are comments through the next '>'.
      if (["!", "?", "/"].includes(html[index + 1] || "")) {
        const end = html.indexOf(">", nameStart);
        index = end === -1 ? html.length : end + 1;
      } else index++;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < html.length && !isHtmlTagBoundary(html[nameEnd])) nameEnd++;
    const tag = html.slice(nameStart, nameEnd).toLowerCase();
    const end = htmlTagEnd(html, nameEnd);
    // At EOF an unfinished tag is discarded by the HTML tokenizer.
    if (end === -1) break;
    index = end;
    if (closing) continue;
    const nonce = tag === "script" || tag === "style" ? nonces[tag] : undefined;
    if (nonce) {
      const escaped = nonce.replace(
        /[&"<>]/g,
        (value) =>
          ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[value]!,
      );
      result.push(html.slice(last, nameEnd), ` nonce="${escaped}"`);
      last = nameEnd;
    }
    if (tag === "plaintext") break;
    if (
      ![
        "script",
        "style",
        "textarea",
        "title",
        "xmp",
        "iframe",
        "noembed",
        "noframes",
        "noscript",
      ].includes(tag)
    )
      continue;
    index = htmlRawTextEnd(html, index, tag);
  }
  result.push(html.slice(last));
  return result.join("");
}

export function htmlDocument(
  html: string,
  theme: HtmlTheme,
  nonces: { script?: string; style?: string } = {},
) {
  // Put our policy first, before any author-controlled markup, including malformed heads.
  // The browser merges a later complete document into this document during parsing.
  const initial = JSON.stringify(htmlThemeMessage(theme)).replace(
    /</g,
    "\\u003c",
  );
  return withHtmlNonces(
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_CSP}"><style id="excord-html-theme"></style><script>
(() => {
    const style = document.getElementById("excord-html-theme");
    const fonts = new Map();
    function adaptT3Defaults() {
        // Prepared exports regenerate this base rule on each host theme update.
        // Edit only T3's defaults, leaving the page's own styles untouched.
        const sheet = document.getElementById("t3-theme")?.sheet;
        if (!sheet) return;
        for (const rule of sheet.cssRules) {
            if (rule.selectorText !== "html") continue;
            for (const property of ["background", "background-color", "font-size", "line-height"])
                rule.style.removeProperty(property);
        }
    }
    new MutationObserver(adaptT3Defaults).observe(document.head, { childList: true, subtree: true, characterData: true });
    function apply(message) {
        if (message?.jsonrpc !== "2.0" || message.method !== "${HTML_THEME_METHOD}") return;
        const params = message.params;
        if (!params?.styles?.variables) return;
        // Binary FontFace sources need no network request from the opaque frame.
        // Discord's inherited policy blocks data URLs as well as cross-origin fonts.
        for (const font of params.styles.fonts || []) {
            const key = JSON.stringify([font.family, font.descriptors]);
            const previous = fonts.get(key);
            if (previous?.data === font.data) continue;
            try {
                const bytes = Uint8Array.from(atob(font.data), character => character.charCodeAt(0));
                const face = new FontFace(font.family, bytes, font.descriptors);
                if (previous) document.fonts.delete(previous.face);
                document.fonts.add(face);
                fonts.set(key, { data: font.data, face });
            } catch {}
        }
        const variables = Object.entries(params.styles.variables).filter(([key, value]) => /^--[a-z0-9-]+$/.test(key) && typeof value === "string");
        // Inline host tokens also win over the fallback palette in prepared T3 exports.
        const root = document.documentElement;
        root.style.colorScheme = params.theme === "light" ? "light" : "dark";
        for (const [key, value] of variables) root.style.setProperty(key, value.replace(/[;{}<>]/g, ""));
        style.textContent = (typeof params.styles.fontFaces === "string" ? params.styles.fontFaces : "") + "\\nhtml{background:transparent;color:var(--foreground);font-family:var(--font-sans);font-size:var(--chat-font-size);font-weight:var(--chat-font-weight);font-style:var(--chat-font-style);line-height:var(--chat-line-height);letter-spacing:var(--chat-letter-spacing)}body{margin:0;font:inherit}button,input,select,textarea{font:inherit}";
    }
    apply(${initial});
    addEventListener("message", event => { if (event.source === parent) apply(event.data); });
    let linkId = 0;
    document.addEventListener("click", event => {
        if (document.getElementById("t3-theme")) return;
        const link = event.composedPath().find(node => node?.matches?.("a[href]"));
        if (!link || link.getAttribute("href").startsWith("#")) return;
        event.preventDefault();
        if (!event.isTrusted) return;
        try {
            const url = new URL(link.getAttribute("href"), document.baseURI);
            if (/^https?:$/.test(url.protocol)) parent.postMessage({ jsonrpc: "2.0", id: "excord-link-" + (++linkId), method: "ui/open-link", params: { url: url.href } }, "*");
        } catch {}
    }, true);
    let lastHeight = 0;
    let pending = false;
    function measure() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            const root = document.documentElement;
            const height = Math.ceil(root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height);
            if (height === lastHeight) return;
            lastHeight = height;
            parent.postMessage({ jsonrpc: "2.0", method: "${HTML_SIZE_METHOD}", params: { height } }, "*");
        });
    }
    addEventListener("DOMContentLoaded", () => {
        adaptT3Defaults();
        const observer = new ResizeObserver(measure);
        observer.observe(document.documentElement);
        if (document.body) observer.observe(document.body);
        measure();
    });
    addEventListener("load", measure);
})();
</script>${html}`,
    nonces,
  );
}
