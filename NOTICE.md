# Attribution

Originally written by Exotic (GitHub: [extoci](https://github.com/extoci)) and Excord contributors. Adapted for Vencord by Pixel Perfect:

- Repository: https://github.com/extoci/excord
- Revision: `bbeeabad0f59ca639edd039ed3e30be34199b6b7`
- Original files: `src/excord/htmlFrame.ts`, `htmlVisualizations.ts`, `inlineVisualizations.ts`, and `visualizations.tsx`.

The original copyright and GPL-3.0-or-later notices are preserved. This plugin is distributed under GPL-3.0-or-later; the full GPLv3 text is in [LICENSE](LICENSE).

The port replaces Excord's module registration with Vencord's native plugin APIs and combines the source/parser helpers. It retains the original sandbox and theme behavior, adds native-rendering error fallbacks, and fixes fence and nonce parsing edge cases.

The extracted Git history preserves upstream author and committer metadata. Original commit IDs are recorded in `Upstream-Commit` trailers and [UPSTREAM.md](UPSTREAM.md). Vencord changes follow the upstream history as separate commits.
