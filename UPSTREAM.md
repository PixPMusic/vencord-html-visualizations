# Upstream renderer history

Original project: [Excord](https://github.com/extoci/excord), by Exotic / extoci and Excord contributors. Extraction stops at Excord revision `bbeeabad0f59ca639edd039ed3e30be34199b6b7`.

Only renderer source files, their original tests/fixture, and their documentation were retained. Unrelated client code and commits were removed. Original author and committer identities and dates are preserved. Messages retain the upstream text with an added `Upstream-Commit` trailer; commit hashes and signatures cannot survive this extraction. The `excord-renderer-base` tag marks the final imported commit before the Vencord port.

| Original Excord commit | Imported commit | Subject |
| --- | --- | --- |
| [`e9e5fde6794f`](https://github.com/extoci/excord/commit/e9e5fde6794f8bd85c8e48a7836494c2dabe6ed5) | `bdbe78feaa7227b0c1109417b7026603855464a6` | feat(plugins): add inline HTML visualizations |
| [`7dd7e53dca86`](https://github.com/extoci/excord/commit/7dd7e53dca862d4931cc78aa0d70c01699ef0dec) | `1c1b2988965659e260086974816c43694a21f5b9` | refactor(plugins): rename renderer to ExcordVisualizations |
| [`a9b44a239470`](https://github.com/extoci/excord/commit/a9b44a239470ea1c82e0aa6a0498c823f5022777) | `1761d831f2265c630b2a6ba0bb71fde3991b4c2b` | fix(plugins): render visualizations inline with chat fonts |
| [`4692a8f24a2c`](https://github.com/extoci/excord/commit/4692a8f24a2c28cdc5b1b9ef7dfd1f4f831cf829) | `16e2899a7691f2fe7cb5b3153b557a1221638ae8` | fix(plugins): replace HTML file cards and blend preview backgrounds |

The following commits adapt the renderer to native Vencord APIs, fix parsing edge cases, and package the plugin independently. Their author is Pixel Perfect <me@pixp.cc>. The GPL-3.0-or-later notices and license remain in place.
