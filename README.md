# HTML Visualizations for Vencord

Render HTML attachments and complete `html` / `html-render` code blocks as interactive pages inside Discord messages. T3's prepared HTML exports work directly, including their controls, inlined images, automatic height, and theme tokens. The existing T3 Discord bridge already uploads this format.

Originally written by **Exotic ([@extoci](https://github.com/extoci))** as [ExcordVisualizations](https://github.com/extoci/excord/blob/main/docs/html-visualizations.md). **Pixel Perfect** maintains this Vencord userplugin port. It runs on the viewing client; other readers need the plugin to see the interactive page. Standard Discord keeps its normal file preview.

## Install

This repository contains only the plugin, its tests, and documentation. It does not include Vencord or Excord. Vencord's [custom-plugin workflow](https://docs.vencord.dev/installing/custom-plugins/) requires building Vencord from source: stock builds do not load separate plugin bundles at runtime.

Install Git, Node.js, and pnpm, then create a separate Vencord checkout:

```sh
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
mkdir -p src/userplugins
```

Clone this plugin directly into the userplugins directory. `PLUGIN_REPOSITORY` can be a published Git URL or an absolute path to your existing clone. For the current local checkout:

```sh
PLUGIN_REPOSITORY=/Users/pixel/projects/vencord-html-visualizations
git clone "$PLUGIN_REPOSITORY" src/userplugins/htmlVisualizations
pnpm install --frozen-lockfile
pnpm build --standalone --disable-updater
```

On another machine, replace `PLUGIN_REPOSITORY` with the plugin's published Git URL or a transferred local repository. No Vencord fork needs to be published or maintained alongside this plugin.

Install the resulting build:

- **Discord Desktop:** run `pnpm inject` and select your Discord installation.
- **Vesktop:** select this checkout's `dist` directory under **Vesktop Settings → Open Developer Settings → Vencord Location**, then fully restart Vesktop.
- **Browser:** run `pnpm buildWeb --standalone --disable-updater` and install the matching extension/userscript from `dist` using [Vencord's instructions](https://docs.vencord.dev/installing/#installing-your-custom-build).

Restart Discord and enable **Settings → Vencord → Plugins → HtmlVisualizations**. The disabled updater prevents an upstream build from replacing your custom build. Update both checkouts and rebuild when you want updates:

```sh
git pull --ff-only
git -C src/userplugins/htmlVisualizations pull --ff-only
pnpm install --frozen-lockfile
pnpm build --standalone --disable-updater
```

### Optional: submodule in your own Vencord fork

Instead of the plugin clone above, a Vencord fork can pin the plugin as a submodule. Use a published plugin Git URL in place of `PLUGIN_REPOSITORY`:

```sh
git submodule add "$PLUGIN_REPOSITORY" src/userplugins/htmlVisualizations
git add .gitmodules src/userplugins/htmlVisualizations
git commit -m "Add HTML visualizations userplugin"
```

When cloning that fork, use `git clone --recurse-submodules ...`, or run `git submodule update --init --recursive` afterward. To update the plugin, run `git submodule update --remote src/userplugins/htmlVisualizations`, review and commit the new pointer, then rebuild Vencord. Keep the plugin at exactly this directory depth so Vencord finds its `index.tsx`.

In the plugin settings, keep **Only apply to bots** enabled. To restrict rendering to a bot, put its Discord user ID in **Allowed users** and leave the other allowlists empty. Existing HTML messages become eligible when you enable the plugin; the bridge does not need to repost them.

Allowed users, channels, and guilds combine as **OR** conditions. A listed parent channel includes its threads. With all lists empty, every location is allowed, subject to the bot restriction. Disable the plugin to restore normal attachment and code-block rendering.

## Supported pages

Upload a complete `.html` / `.htm` document, or send a complete fenced `html` / `html-render` block. Each message supports up to four previews, with a 25 MiB limit per page. Normal attachments remain visible, and HTML keeps its native file card until rendering succeeds.

Pages run in an opaque `allow-scripts` iframe with no access to Discord's document, cookies, storage, Node, or native bridge. Inline scripts and styles support Discord's nonce policy. Use `addEventListener` or script-assigned handlers; inline attributes such as `onclick="..."` may be blocked by the host policy.

The inherited Discord policy and the page policy both apply. Data images, HTTPS images, and scripts from jsDelivr/cdnjs are supported where Discord permits them. Network API requests, nested frames, forms, popups, and filesystem access are blocked. Bundle data and dependencies when possible. T3's prepared exports already inline local images.

## Validation

Run `npm test` with Node.js 24 or newer; no dependency installation is needed for these helper tests. The 27 renderer tests cover filtering, HTML extraction, download bounds, nonces, resize/link messages, and parser restoration. Standalone desktop and web builds and a scoped typecheck pass against Vencord `32c90633ce6a95d7e56c95479efbb431bacf1eac`. Signed-in Discord rendering and its private attachment hook still need a client check after installation; a build cannot prove compatibility with every Discord release.

## Credits and license

Original renderer: **Exotic / extoci and Excord contributors**. Vencord adaptation and packaging: **Pixel Perfect**.

The renderer history is extracted from Excord through `bbeeabad0f59ca639edd039ed3e30be34199b6b7`, followed by the Vencord port commits. Original author/committer identities, timestamps, and messages are retained; each imported message adds an `Upstream-Commit` trailer. Removing unrelated files changes Git hashes and does not preserve commit signatures. See [UPSTREAM.md](UPSTREAM.md) for the original-to-imported mapping.

This project retains **GPL-3.0-or-later**, including the original copyright notices. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
