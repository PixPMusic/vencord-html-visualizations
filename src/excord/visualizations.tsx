/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactTypes from "react";

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
  type HtmlChannel,
  type HtmlFilters,
  type HtmlMessage,
  type HtmlSource,
  htmlSources,
} from "./htmlVisualizations";
import {
  type HtmlCodeBlock,
  type MarkdownState,
  replaceHtmlCodeBlocks,
  type VisualizationParser,
} from "./inlineVisualizations";

interface HtmlSettings {
  use(): HtmlFilters & { enabled: boolean };
}

interface SettingsApi {
  definePluginSettings(
    definition: Record<
      string,
      {
        type: number;
        displayName: string;
        description: string;
        default: string | boolean;
        multiline?: boolean;
      }
    >,
  ): HtmlSettings;
}

export function createExcordVisualizationsPlugin(
  modules: Record<string, unknown>,
) {
  const { definePluginSettings } = modules["@api/Settings"] as SettingsApi;
  const { OptionType } = modules["@utils/types"] as {
    OptionType: { BOOLEAN: number; STRING: number };
  };
  // Keep the namespace: Discord's React and stores become available after catalog registration.
  const common = modules["@webpack/common"] as {
    React: typeof ReactTypes;
    ChannelStore: { getChannel(id: string): HtmlChannel | undefined };
    MessageStore?: {
      getMessage(channelId: string, messageId: string): HtmlMessage | undefined;
      getMessages?(channelId: string): {
        forEach(callback: (message: HtmlMessage) => void): void;
      };
    };
    SelectedChannelStore?: { getChannelId(): string | undefined };
    Parser?: VisualizationParser;
  };
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
  });
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
  }: {
    html: string;
    title: string;
    messageId?: string;
  }) {
    const { React } = common;
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
        if (mounted) setSrcDoc(htmlDocument(html, theme, readHtmlNonces()));
      });
      return () => {
        mounted = false;
      };
    }, [html]);
    const sendTheme = () => {
      const generation = ++themeGeneration.current;
      void embedHtmlFonts(readHtmlTheme(host())).then((theme) => {
        if (generation === themeGeneration.current)
          ref.current?.contentWindow?.postMessage(htmlThemeMessage(theme), "*");
      });
    };
    React.useLayoutEffect(() => {
      const receive = (event: MessageEvent) => {
        if (
          !ref.current?.contentWindow ||
          event.source !== ref.current.contentWindow
        )
          return;
        const next = htmlContentHeight(event.data);
        if (next !== undefined) setHeight(next);
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
  }: {
    source: HtmlSource;
    messageId: string;
  }) {
    const { React } = common;
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
      <Frame html={html} title={source.title} messageId={messageId} />
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
    fallback: () => ReactTypes.ReactNode;
  }) {
    const { React } = common;
    const filters = settings.use();
    const active = React.useSyncExternalStore(subscribe, () => running);
    const message =
      state.channelId && state.messageId
        ? common.MessageStore?.getMessage(state.channelId, state.messageId)
        : undefined;
    if (
      !active ||
      !filters.enabled ||
      !message ||
      !allowsHtml(
        message,
        common.ChannelStore.getChannel(message.channel_id),
        filters,
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

  let installedParser: VisualizationParser | undefined;
  let restoreCodeBlocks: (() => void) | undefined;
  function installCodeBlocks(parser: VisualizationParser) {
    if (
      !running ||
      !parser.defaultRules?.codeBlock ||
      installedParser === parser
    )
      return;
    restoreCodeBlocks?.();
    restoreCodeBlocks = replaceHtmlCodeBlocks(
      parser,
      (node, state, fallback) => {
        if (!state.messageId || !state.channelId) return fallback();
        return common.React.createElement(InlineBlock, {
          node,
          state,
          fallback,
          key: state.key,
        });
      },
    );
    installedParser = parser;
    // Refresh already-visible messages when the plugin is enabled in Settings.
    const channelId = common.SelectedChannelStore?.getChannelId();
    const updater = modules["@api/MessageUpdater"] as
      { updateMessage(channelId: string, messageId: string): void } | undefined;
    if (channelId && updater)
      common.MessageStore?.getMessages?.(channelId).forEach((message) => {
        if (htmlSources(message).some((source) => "html" in source))
          updater.updateMessage(channelId, message.id);
      });
  }

  function Accessory({ message }: { message: HtmlMessage }) {
    const { React } = common;
    const filters = settings.use();
    const active = React.useSyncExternalStore(subscribe, () => running);
    if (
      !active ||
      !filters.enabled ||
      !allowsHtml(
        message,
        common.ChannelStore.getChannel(message.channel_id),
        filters,
      )
    )
      return null;
    return (
      <>
        {htmlSources({ ...message, content: "" }).map((source) => (
          <Visualization
            key={`${message.id}-${source.key}`}
            source={source}
            messageId={message.id}
          />
        ))}
      </>
    );
  }

  return {
    name: "ExcordVisualizations",
    description:
      "Render interactive HTML code blocks and attachments, including pages exported from T3 Code.",
    authors: [{ name: "Excord", id: 0n }],
    enabledByDefault: false,
    dependencies: ["MessageUpdaterAPI"],
    settings,
    start() {
      updateRunning(true);
      if (common.Parser) installCodeBlocks(common.Parser);
      else
        (
          modules["@webpack"] as
            | {
                waitFor(
                  name: string,
                  callback: (parser: VisualizationParser) => void,
                ): void;
              }
            | undefined
        )?.waitFor("parseTopic", installCodeBlocks);
    },
    stop() {
      updateRunning(false);
      restoreCodeBlocks?.();
      restoreCodeBlocks = undefined;
      installedParser = undefined;
    },
    renderMessageAccessory: (props: { message: HtmlMessage }) =>
      common.React.createElement(Accessory, props),
  };
}
