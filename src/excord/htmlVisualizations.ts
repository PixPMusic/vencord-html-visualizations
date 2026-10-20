/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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
  const [users, channels, guilds] = lists.map(
    (list) => new Set(list.split(/[\s,]+/).filter(Boolean)),
  );
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
  // Consume every fence, including non-HTML fences, so nested examples aren't executed.
  const fences =
    /(?:^|\n) {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n {0,3}\1[\t ]*(?=\n|$)/g;
  for (const match of (message.content ?? "").matchAll(fences)) {
    if (!/^html(?:-render)?(?:\s|$)/i.test(match[2].trim())) continue;
    const html = match[3].trim();
    if (!html || new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES)
      continue;
    sources.push({
      key: `code-${match.index}`,
      title: "HTML visualization",
      html,
    });
    if (sources.length === MAX_VISUALIZATIONS) return sources;
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
