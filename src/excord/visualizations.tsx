/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactTypes from "react";

import {
  HTML_SANDBOX,
  htmlContentHeight,
  htmlDocument,
  htmlLinkRequest,
  htmlThemeMessage,
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

  function Frame({ html, title }: { html: string; title: string }) {
    const { React } = common;
    const ref = React.useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = React.useState(320);
    const [srcDoc, setSrcDoc] = React.useState<string>();
    React.useLayoutEffect(() => {
      // Read the mounted message's scope before any authored script runs.
      setSrcDoc(
        htmlDocument(
          html,
          readHtmlTheme(ref.current ?? document.documentElement),
        ),
      );
    }, [html]);
    const sendTheme = () =>
      ref.current?.contentWindow?.postMessage(
        htmlThemeMessage(
          readHtmlTheme(ref.current ?? document.documentElement),
        ),
        "*",
      );
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
        }}
      />
    );
  }

  function Visualization({ source }: { source: HtmlSource }) {
    const { React } = common;
    const [expanded, setExpanded] = React.useState(true);
    const inline = "html" in source ? source.html : undefined;
    const url = "url" in source ? source.url : undefined;
    const [loaded, setLoaded] = React.useState<{
      url: string;
      html?: string;
      error?: string;
    }>();
    React.useEffect(() => {
      if (!expanded || !url) return;
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
    }, [url, expanded]);
    const html = inline ?? (loaded?.url === url ? loaded?.html : undefined);
    return (
      <section
        aria-label={source.title}
        style={{ maxWidth: 1000, marginTop: 8 }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          style={{
            color: "var(--text-link)",
            background: "none",
            border: 0,
            cursor: "pointer",
            padding: "4px 0",
            font: "inherit",
            fontSize: 12,
          }}
        >
          {expanded ? "Hide" : "Show"} visualization · {source.title}
        </button>
        {expanded &&
          (html !== undefined ? (
            <Frame html={html} title={source.title} />
          ) : (
            <p role="status">
              {(loaded?.url === url && loaded?.error) ||
                "Loading HTML visualization…"}
            </p>
          ))}
      </section>
    );
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
        {htmlSources(message).map((source) => (
          <Visualization key={`${message.id}-${source.key}`} source={source} />
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
    settings,
    start() {
      updateRunning(true);
    },
    stop() {
      updateRunning(false);
    },
    renderMessageAccessory: (props: { message: HtmlMessage }) =>
      common.React.createElement(Accessory, props),
  };
}
