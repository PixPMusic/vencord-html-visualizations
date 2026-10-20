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
  const foreground = token(
    ["--text-default", "--text-normal"],
    light ? "#313338" : "#dbdee1",
  );
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
    "--font-sans": token(["--font-primary"], "system-ui, sans-serif"),
    "--font-mono": token(["--font-code"], "monospace"),
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
  return { appearance, variables };
}

export function htmlThemeMessage(theme: HtmlTheme) {
  return {
    jsonrpc: "2.0",
    method: HTML_THEME_METHOD,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
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

export function htmlDocument(html: string, theme: HtmlTheme) {
  // Put our policy first, before any author-controlled markup, including malformed heads.
  // The browser merges a later complete document into this document during parsing.
  const initial = JSON.stringify(htmlThemeMessage(theme)).replace(
    /</g,
    "\\u003c",
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_CSP}"><style id="excord-html-theme"></style><script>
(() => {
    const style = document.getElementById("excord-html-theme");
    function apply(message) {
        if (message?.jsonrpc !== "2.0" || message.method !== "${HTML_THEME_METHOD}") return;
        const params = message.params;
        if (!params?.styles?.variables) return;
        const variables = Object.entries(params.styles.variables).filter(([key, value]) => /^--[a-z0-9-]+$/.test(key) && typeof value === "string");
        // Inline host tokens also win over the fallback palette in prepared T3 exports.
        const root = document.documentElement;
        root.style.colorScheme = params.theme === "light" ? "light" : "dark";
        for (const [key, value] of variables) root.style.setProperty(key, value.replace(/[;{}<>]/g, ""));
        style.textContent = "html{background:var(--background);color:var(--foreground);font-family:var(--font-sans)}body{margin:0}";
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
        const observer = new ResizeObserver(measure);
        observer.observe(document.documentElement);
        if (document.body) observer.observe(document.body);
        measure();
    });
    addEventListener("load", measure);
})();
</script>${html}`;
}
