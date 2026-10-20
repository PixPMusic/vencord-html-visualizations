/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Excord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

import { MAX_HTML_BYTES } from "./htmlVisualizations";

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
