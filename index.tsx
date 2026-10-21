/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Native Vencord userplugin port of Excord's HTML visualizations.
 */

import { updateMessage } from "@api/MessageUpdater";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { waitFor } from "@webpack";
import { ChannelStore, MessageStore, Parser, React, SelectedChannelStore } from "@webpack/common";
import type { ReactNode } from "react";

import {
  embedHtmlFonts,
  HTML_SANDBOX,
  htmlContentHeight,
  htmlDocument,
  htmlLinkRequest,
  htmlThemeMessage,
  readHtmlNonces,
  readHtmlTheme,
} from "./htmlFrame";
import {
  allowsHtml,
  fetchHtmlAttachment,
  type HtmlCodeBlock,
  type HtmlSource,
  htmlSources,
  type MarkdownState,
  replaceHtmlCodeBlocks,
  type VisualizationParser,
} from "./htmlVisualizations";

const settings = definePluginSettings({
  onlyBots: {
    type: OptionType.BOOLEAN,
    displayName: "Only apply to bots",
    description: "Only render HTML in messages sent by bots.",
    default: true,
  },
  allowedUsers: {
    type: OptionType.STRING,
    displayName: "Allowed users",
    description:
      "Comma-separated list of user IDs allowed to render HTML. A match in any allowlist permits rendering. Leave all lists empty to allow everyone.",
    default: "",
    multiline: true,
  },
  allowedChannels: {
    type: OptionType.STRING,
    displayName: "Allowed channels",
    description:
      "Comma-separated list of channel IDs allowed to render HTML. Includes threads in listed channels.",
    default: "",
    multiline: true,
  },
  allowedGuilds: {
    type: OptionType.STRING,
    displayName: "Allowed guilds",
    description: "Comma-separated list of guild IDs allowed to render HTML.",
    default: "",
    multiline: true,
  },
}).withPrivateSettings<{ enabled: boolean }>();
let running = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const updateRunning = (value: boolean) => {
  running = value;
  for (const listener of listeners) listener();
};

function Frame({
  html,
  title,
  messageId,
  onReady,
}: {
  html: string;
  title: string;
  messageId?: string;
  onReady?: () => void;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(320);
  const [srcDoc, setSrcDoc] = React.useState<string>();
  const themeGeneration = React.useRef(0);
  const host = () =>
    (messageId && document.getElementById(`message-content-${messageId}`)) ||
    ref.current?.parentElement ||
    document.documentElement;
  React.useLayoutEffect(() => {
    // Read the mounted message's scope before any authored script runs.
    let mounted = true;
    void embedHtmlFonts(readHtmlTheme(host())).then((theme) => {
      if (mounted) {
        // Chromium gives a frame an opaque canvas if its color scheme differs
        // from the embedding element, even with a transparent page background.
        if (ref.current) ref.current.style.colorScheme = theme.appearance;
        setSrcDoc(htmlDocument(html, theme, readHtmlNonces()));
      }
    });
    return () => {
      mounted = false;
    };
  }, [html]);
  const sendTheme = () => {
    const generation = ++themeGeneration.current;
    void embedHtmlFonts(readHtmlTheme(host())).then((theme) => {
      if (generation === themeGeneration.current) {
        if (ref.current) ref.current.style.colorScheme = theme.appearance;
        ref.current?.contentWindow?.postMessage(htmlThemeMessage(theme), "*");
      }
    });
  };
  React.useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !ref.current?.contentWindow ||
        event.source !== ref.current.contentWindow ||
        event.origin !== "null"
      )
        return;
      const next = htmlContentHeight(event.data);
      if (next !== undefined) {
        setHeight(next);
        onReady?.();
      }
      const request = htmlLinkRequest(event.data);
      if (
        request &&
        document.activeElement === ref.current &&
        navigator.userActivation?.isActive
      ) {
        window.open(request.url, "_blank", "noopener,noreferrer");
        ref.current.contentWindow.postMessage(
          { jsonrpc: "2.0", id: request.id, result: {} },
          "*",
        );
      }
    };
    const observer = new MutationObserver(sendTheme);
    observer.observe(host(), {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    for (
      let element = ref.current?.parentElement;
      element;
      element = element.parentElement
    ) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "media", "disabled"],
    });
    const stylesheetLoaded = (event: Event) => {
      if (
        event.target instanceof HTMLLinkElement &&
        event.target.relList.contains("stylesheet")
      )
        sendTheme();
    };
    sendTheme();
    document.addEventListener("load", stylesheetLoaded, true);
    window.addEventListener("message", receive);
    return () => {
      observer.disconnect();
      document.removeEventListener("load", stylesheetLoaded, true);
      window.removeEventListener("message", receive);
    };
  }, []);
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox={HTML_SANDBOX}
      srcDoc={srcDoc}
      onLoad={sendTheme}
      referrerPolicy="no-referrer"
      loading="lazy"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'"
      style={{
        display: "block",
        width: "100%",
        height,
        border: 0,
        background: "transparent",
        font: "inherit",
        color: "inherit",
      }}
    />
  );
}

function Visualization({
  source,
  messageId,
  onReady,
}: {
  source: HtmlSource;
  messageId: string;
  onReady: () => void;
}) {
  const inline = "html" in source ? source.html : undefined;
  const url = "url" in source ? source.url : undefined;
  const [loaded, setLoaded] = React.useState<{
    url: string;
    html?: string;
    error?: string;
  }>();
  React.useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoaded({ url, error: "HTML attachment took too long to load." });
      controller.abort();
    }, 15000);
    void fetchHtmlAttachment(url, controller.signal)
      .then(
        (html) => {
          if (!controller.signal.aborted) setLoaded({ url, html });
        },
        () => {
          if (!controller.signal.aborted)
            setLoaded({ url, error: "Could not load HTML attachment." });
        },
      )
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [url]);
  const html = inline ?? (loaded?.url === url ? loaded?.html : undefined);
  return html !== undefined ? (
    <Frame
      html={html}
      title={source.title}
      messageId={messageId}
      onReady={onReady}
    />
  ) : (
    <p role="status">
      {(loaded?.url === url && loaded?.error) ||
        "Loading HTML visualization…"}
    </p>
  );
}

function InlineBlock({
  node,
  state,
  fallback,
}: {
  node: HtmlCodeBlock;
  state: MarkdownState;
  fallback: () => ReactNode;
}) {
  const filters = settings.use();
  const active = React.useSyncExternalStore(subscribe, () => running);
  const message =
    state.channelId && state.messageId
      ? MessageStore?.getMessage(state.channelId, state.messageId)
      : undefined;
  // Discord also parses unfinished fences; execute only complete message sources.
  if (
    !active ||
    !filters.enabled ||
    !message ||
    !allowsHtml(
      message,
      ChannelStore.getChannel(message.channel_id),
      filters,
    ) ||
    !htmlSources(message).some(
      (source) => "html" in source && source.html.trim() === node.content.trim(),
    )
  )
    return fallback();
  return (
    <Frame
      html={node.content}
      title="HTML visualization"
      messageId={message.id}
    />
  );
}

let installedParser: typeof Parser | undefined;
let restoreCodeBlocks: (() => void) | undefined;
function refreshMessages() {
  const channelId = SelectedChannelStore?.getChannelId();
  if (!channelId) return;
  MessageStore?.getMessages(channelId).forEach((message) => {
    if (htmlSources(message).length) updateMessage(channelId, message.id);
  });
}

function installCodeBlocks(parser: typeof Parser) {
  const codeBlock = parser.defaultRules?.codeBlock;
  if (
    !running ||
    typeof codeBlock?.react !== "function" ||
    installedParser === parser
  )
    return;
  restoreCodeBlocks?.();
  restoreCodeBlocks = replaceHtmlCodeBlocks(
    { defaultRules: { codeBlock } } satisfies VisualizationParser,
    (node, state, fallback) => {
      if (!state.messageId || !state.channelId) return fallback();
      return (
        <ErrorBoundary key={state.key} fallback={fallback}>
          <InlineBlock node={node} state={state} fallback={fallback} />
        </ErrorBoundary>
      );
    },
  );
  installedParser = parser;
  // Refresh already-visible messages when the plugin is enabled in Settings.
  refreshMessages();
}

function Attachments({
  message,
  renderNative,
}: {
  message: Message;
  renderNative: (message: Message) => ReactNode;
}) {
  const filters = settings.use();
  const active = React.useSyncExternalStore(subscribe, () => running);
  const [ready, setReady] = React.useState<Set<string>>(() => new Set());
  const eligible =
    active &&
    filters.enabled &&
    allowsHtml(
      message,
      ChannelStore.getChannel(message.channel_id),
      filters,
    );
  React.useEffect(() => {
    if (!eligible)
      setReady((previous) => (previous.size ? new Set() : previous));
  }, [eligible]);
  if (!eligible) return renderNative(message);
  const sources = htmlSources(message).filter((source) => "url" in source);
  const rendered = new Set(
    sources
      .filter(
        (source) =>
          "url" in source && ready.has(`${source.key}:${source.url}`),
      )
      .map((source) => source.key),
  );
  const attachments = message.attachments?.filter(
    (attachment) => !rendered.has(`attachment-${attachment.id}`),
  );
  // Preserve Discord's message record and never edit the cached message.
  const nativeMessage =
    attachments?.length === message.attachments?.length ||
    typeof message.merge !== "function"
      ? message
      : message.merge({ attachments });
  return (
    <>
      {renderNative(nativeMessage)}
      {sources.map((source) => (
        <Visualization
          key={`${source.key}:${"url" in source ? source.url : ""}`}
          source={source}
          messageId={message.id}
          onReady={() => {
            if (!("url" in source)) return;
            const key = `${source.key}:${source.url}`;
            setReady((previous) =>
              previous.has(key) ? previous : new Set(previous).add(key),
            );
          }}
        />
      ))}
    </>
  );
}

export default definePlugin({
  name: "HtmlVisualizations",
  description:
    "Render interactive HTML code blocks and attachments, including pages exported from T3 Code. Ported from Excord.",
  authors: [{ name: "Excord", id: 0n }],
  enabledByDefault: false,
  dependencies: ["MessageUpdaterAPI"],
  patches: [
    {
      find: "this.renderAttachments(",
      replacement: {
        match: /this\.renderAttachments\(([A-Za-z_$][\w$]*)\)/g,
        replace:
          "$self.renderAttachments($1,excordMessage=>this.renderAttachments(excordMessage))",
      },
    },
  ],
  settings,
  start() {
    updateRunning(true);
    if (Parser) installCodeBlocks(Parser);
    else waitFor("parseTopic", installCodeBlocks);
  },
  stop() {
    updateRunning(false);
    restoreCodeBlocks?.();
    restoreCodeBlocks = undefined;
    installedParser = undefined;
    refreshMessages();
  },
  renderAttachments: (
    message: Message,
    renderNative: (message: Message) => ReactNode,
  ) => (
    <ErrorBoundary key={message.id} fallback={() => renderNative(message)}>
      <Attachments message={message} renderNative={renderNative} />
    </ErrorBoundary>
  ),
});
