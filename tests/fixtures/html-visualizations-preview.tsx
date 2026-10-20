import * as React from "react";
import { createRoot } from "react-dom/client";

import { createExcordVisualizationsPlugin } from "../../src/excord/visualizations";
import type { HtmlFilters, HtmlMessage } from "../../src/excord/htmlVisualizations";

let filters: HtmlFilters & { enabled: boolean } = { enabled: true, onlyBots: true, allowedUsers: "", allowedChannels: "", allowedGuilds: "" };
const listeners = new Set<() => void>();
const channel = { guild_id: "300", parent_id: "400", isThread: () => true };
const parser = { defaultRules: { codeBlock: { react: (node: { lang?: string; content: string }, _output: unknown, state: { key?: string | number; channelId?: string; messageId?: string }) => <pre key={state.key}><code>{node.content}</code></pre> as React.ReactNode } } };
const plugin = createExcordVisualizationsPlugin({
    "@api/Settings": { definePluginSettings: () => ({ use: () => React.useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => filters) }) },
    "@utils/types": { OptionType: { BOOLEAN: 1, STRING: 2 } },
    "@webpack/common": { React, Parser: parser, MessageStore: { getMessage: () => message }, ChannelStore: { getChannel: () => channel } }
});
const root = createRoot(document.getElementById("root")!);
const reports: unknown[] = [];
window.addEventListener("message", event => {
    if (event.data?.probe) reports.push(event.data);
});
const defaultHtml = `<!doctype html><html><head><style id="t3-theme">:root{--background:magenta;--foreground:lime;--accent:orange;--primary:red}html{background:var(--background);font-size:14px;line-height:1.5}</style><style>body{padding:16px}button{padding:8px 16px;background:var(--primary);color:var(--primary-foreground);border:1px solid var(--border);border-radius:var(--radius);font:inherit}#result{height:120px;background:var(--card);border-radius:var(--radius);margin-top:12px;padding:12px}</style></head><body><h2>Interactive visualization</h2><button id="increment">Increment</button><div id="result">0</div><script>
addEventListener('message',event=>{if(event.data?.method==='ui/notifications/host-context-changed')document.getElementById('t3-theme').textContent=':root{--background:magenta}html{background:var(--background);font-size:14px;line-height:1.5}'});
let count=0;document.getElementById('increment').onclick=()=>{document.getElementById('result').textContent=String(++count);parent.postMessage({probe:'count',count},'*')};
let parentBlocked=false,storageBlocked=false;try{parent.document.body}catch{parentBlocked=true}try{localStorage.getItem('session')}catch{storageBlocked=true}
parent.postMessage({probe:'isolation',parentBlocked,storageBlocked,native:typeof ExcordNative,node:typeof require},'*');
function reportTheme(stage){const style=getComputedStyle(document.documentElement);const values=Object.fromEntries(['background','foreground','primary','primary-foreground','accent','card','border','input','warning','success','chart-2','font-sans','radius'].map(key=>[key,style.getPropertyValue('--'+key).trim()]));parent.postMessage({probe:'theme',stage,values,appearance:style.colorScheme,background:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,fontSize:getComputedStyle(document.body).fontSize,lineHeight:getComputedStyle(document.body).lineHeight},'*')}
reportTheme('author-script');
addEventListener('message',event=>{if(event.data?.testTheme)requestAnimationFrame(()=>reportTheme('update'))});
</script></body></html>`;
let message: HtmlMessage = { id: "1", author: { id: "100", bot: true }, channel_id: "200", content: "Sample weekly tasks chart", attachments: [{ id: "html-file", filename: "chart.html", size: 1024, url: "https://cdn.discordapp.com/attachments/1/2/chart.html" }, { id: "text-file", filename: "notes.txt", size: 10, url: "https://cdn.discordapp.com/attachments/1/2/notes.txt" }] };
const realFetch = window.fetch;
window.fetch = (async (url, options) => String(url).includes("/attachments/1/2/chart.html") ? new Response(defaultHtml) : realFetch(url, options)) as typeof fetch;
function NativeAttachment({ attachment }: { attachment: NonNullable<HtmlMessage["attachments"]>[number] }) {
    return <article className="native-attachment" data-attachment-id={attachment.id}><pre>{attachment.filename.endsWith(".html") ? defaultHtml : "Notes"}</pre><a href={attachment.url}>{attachment.filename}</a></article>;
}
function render() {
    const content = message.content || "";
    const children: React.ReactNode[] = [];
    const blocks = /```([^\n]*)\n([\s\S]*?)```/g;
    let last = 0;
    for (let match; (match = blocks.exec(content));) {
        children.push(<p key={"before" + match.index}>{content.slice(last, match.index)}</p>);
        children.push(parser.defaultRules.codeBlock.react({ lang: match[1], content: match[2] }, null, { key: String(match.index), channelId: message.channel_id, messageId: message.id }));
        last = blocks.lastIndex;
    }
    children.push(<p key="after">{content.slice(last)}</p>);
    root.render(<article className="message"><div id={"message-content-" + message.id} style={{ fontFamily: "Arial, sans-serif", fontSize: "18px", lineHeight: "27px" }}>{children}</div>{plugin.renderAttachments(message, nativeMessage => nativeMessage.attachments?.map(attachment => <NativeAttachment key={attachment.id} attachment={attachment} />))}</article>);
}
plugin.start();
render();
Object.assign(window, {
    ExcordNative: { session: "must not be readable by the frame" },
    htmlProbe: {
        reports, plugin, defaultHtml, render, NativeAttachment,
        setFilters(next: Partial<typeof filters>) { filters = { ...filters, ...next }; for (const listener of listeners) listener(); },
        setMessage(next: Partial<HtmlMessage>) { message = { ...message, ...next }; render(); },
        theme(light: boolean) {
            document.documentElement.classList.toggle("theme-light", light);
            document.documentElement.style.setProperty("--background-primary", light ? "#ffffff" : "#313338");
            document.documentElement.style.setProperty("--text-normal", light ? "#313338" : "#dbdee1");
            document.documentElement.style.setProperty("--background-base-lower", light ? "#ffffff" : "#1a1a1e");
            document.documentElement.style.setProperty("--message-background-hover", light ? "#f2f3f5" : "#26262a");
        }
    }
});
