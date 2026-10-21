/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

export const MAX_HTML_BYTES = 25 * 1024 * 1024;
export const MAX_VISUALIZATIONS = 4;

export interface HtmlFilters {
  onlyBots: boolean;
  allowedUsers: string;
  allowedChannels: string;
  allowedGuilds: string;
}

export interface HtmlMessage {
  id: string;
  content?: string;
  channel_id: string;
  author?: { id: string; bot?: boolean };
  attachments?: { id: string; filename: string; url: string; size: number }[];
}

export interface HtmlChannel {
  guild_id?: string;
  parent_id?: string | null;
  isThread?(): boolean;
}

// Like MessageLogger's ignore lists, a match in any list applies to the message.
// An explicitly populated but invalid list must never turn into "allow everyone".
export function allowsHtml(
  message: HtmlMessage,
  channel: HtmlChannel | undefined,
  filters: HtmlFilters,
) {
  if (filters.onlyBots && !message.author?.bot) return false;
  const lists = [
    filters.allowedUsers,
    filters.allowedChannels,
    filters.allowedGuilds,
  ];
  if (lists.every((list) => !list.trim())) return true;
  const ids = (list: string) => new Set(list.split(/[\s,]+/).filter(Boolean));
  const users = ids(filters.allowedUsers);
  const channels = ids(filters.allowedChannels);
  const guilds = ids(filters.allowedGuilds);
  return !!(
    (message.author?.id && users.has(message.author.id)) ||
    channels.has(message.channel_id) ||
    (channel?.isThread?.() &&
      channel.parent_id &&
      channels.has(channel.parent_id)) ||
    (channel?.guild_id && guilds.has(channel.guild_id))
  );
}

export type HtmlSource = { key: string; title: string } & (
  { html: string } | { url: string }
);

export function discordHtmlAttachmentUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) &&
      url.pathname.startsWith("/attachments/")
    );
  } catch {
    return false;
  }
}

export function htmlSources(message: HtmlMessage): HtmlSource[] {
  const sources: HtmlSource[] = [];
  const content = message.content ?? "";
  let fence: { marker: string; length: number; language: string; start: number; body: number } | undefined;
  let offset = 0;
  // An unclosed outer example still owns its inner fences. Closers may be longer
  // than the opener, as in Discord's Markdown parser.
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (fence) {
      const close = /^ {0,3}(`+|~+)[\t ]*$/.exec(line)?.[1];
      if (close?.[0] === fence.marker && close.length >= fence.length) {
        if (/^html(?:-render)?(?:\s|$)/i.test(fence.language)) {
          const html = content.slice(fence.body, offset).trim();
          if (html && new TextEncoder().encode(html).byteLength <= MAX_HTML_BYTES) {
            sources.push({ key: `code-${fence.start}`, title: "HTML visualization", html });
            if (sources.length === MAX_VISUALIZATIONS) return sources;
          }
        }
        fence = undefined;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
        fence = { marker: open[1]![0]!, length: open[1]!.length,
          language: open[2]!.trim(), start: offset, body: offset + rawLine.length + 1 };
      }
    }
    offset += rawLine.length + 1;
  }
  for (const attachment of message.attachments ?? []) {
    if (
      !/\.html?$/i.test(attachment.filename) ||
      attachment.size > MAX_HTML_BYTES ||
      !discordHtmlAttachmentUrl(attachment.url)
    )
      continue;
    sources.push({
      key: `attachment-${attachment.id}`,
      title: attachment.filename,
      url: attachment.url,
    });
    if (sources.length === MAX_VISUALIZATIONS) break;
  }
  return sources;
}

export async function fetchHtmlAttachment(url: string, signal: AbortSignal) {
  if (!discordHtmlAttachmentUrl(url))
    throw new Error("Invalid HTML attachment URL.");
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error(`Could not load HTML attachment (${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_HTML_BYTES) {
    await response.body?.cancel();
    throw new Error("HTML attachment exceeds 25 MiB.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("HTML attachment is empty.");
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES)
        throw new Error("HTML attachment exceeds 25 MiB.");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

export interface HtmlCodeBlock {
  lang?: string;
  content: string;
}

export interface MarkdownState {
  channelId?: string;
  messageId?: string;
  key?: string | number;
}

export type CodeBlockRenderer = (
  node: HtmlCodeBlock,
  output: unknown,
  state: MarkdownState,
) => ReactNode;
export interface VisualizationParser {
  defaultRules: { codeBlock: { react: CodeBlockRenderer } };
}

export function isHtmlCodeBlock(node: HtmlCodeBlock) {
  return (
    /^(?:html|html-render)$/i.test(node.lang ?? "") &&
    !!node.content.trim() &&
    new TextEncoder().encode(node.content).byteLength <= MAX_HTML_BYTES
  );
}

export function replaceHtmlCodeBlocks(
  parser: VisualizationParser,
  render: (
    node: HtmlCodeBlock,
    state: MarkdownState,
    fallback: () => ReactNode,
  ) => ReactNode,
) {
  const rule = parser.defaultRules.codeBlock;
  const original = rule.react;
  const wrapped: CodeBlockRenderer = function (
    this: unknown,
    node,
    output,
    state,
  ) {
    if (!isHtmlCodeBlock(node)) return original.call(this, node, output, state);
    // Markdown reuses its state while walking siblings. Retain this block's key/context.
    const savedState = { ...state };
    return render(node, savedState, () =>
      original.call(rule, node, output, savedState),
    );
  };
  rule.react = wrapped;
  return () => {
    if (rule.react === wrapped) rule.react = original;
  };
}
