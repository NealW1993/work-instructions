"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";

import { parseChartSource } from "@/lib/editor-content";
import { buildChartHtml } from "@/lib/instruction-chart";
import { resolveAccessibleMediaUrl } from "@/lib/media-url";
import { CHART_EDIT_EVENT, ChartBlockBase, type ChartEditRequest, chartFromAttributes, MediaFigureBase } from "@/lib/rich-editor-schema";
import { cn } from "@/lib/utils";

/* On-screen views for the editor's chart and media blocks (see lib/rich-editor-schema for the blocks). */

function ChartBlockView({ node, selected, editor, getPos }: ReactNodeViewProps) {
  const chart = chartFromAttributes(node.attrs);
  const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
  const problem = chart ? null : parseChartSource(source).error ?? "This chart has no data yet.";
  return (
    <NodeViewWrapper className={cn("editor-chart-block", selected && "is-selected")} contentEditable={false} data-drag-handle="">
      {chart ? (
        // The chart markup is generated from validated numbers with every label escaped.
        <div dangerouslySetInnerHTML={{ __html: buildChartHtml(chart) }} />
      ) : (
        <aside data-type="callout" data-tone="danger" className="instruction-callout">
          <p><strong>This chart needs attention.</strong> {problem}</p>
          {source ? <pre className="whitespace-pre-wrap text-xs">{source}</pre> : null}
        </aside>
      )}
      <button
        type="button"
        className="editor-block-button"
        onClick={() => {
          const pos = getPos();
          if (typeof pos !== "number") return;
          const request: ChartEditRequest = { pos, chart: chart ?? undefined };
          editor.view.dom.dispatchEvent(new CustomEvent(CHART_EDIT_EVENT, { detail: request }));
        }}
      >
        Edit chart
      </button>
    </NodeViewWrapper>
  );
}

export const ChartBlock = ChartBlockBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ChartBlockView);
  },
});

function MediaFigureView({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const isVideo = node.attrs.kind === "video";
  const src = resolveAccessibleMediaUrl(node.attrs.src);
  const name = node.attrs.alt || (isVideo ? "video" : "photo");
  return (
    <NodeViewWrapper
      as="figure"
      data-type={isVideo ? "resizable-video" : "resizable-image"}
      data-align="center"
      className={cn("editor-media", selected && "is-selected")}
      contentEditable={false}
      data-drag-handle=""
    >
      {isVideo ? (
        <video controls playsInline preload="metadata" src={src} aria-label={node.attrs.alt || "Video"} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- media lives in Supabase storage, not the Next image pipeline.
        <img src={src} alt={node.attrs.alt || ""} />
      )}
      <input
        value={node.attrs.caption ?? ""}
        onChange={(event) => updateAttributes({ caption: event.target.value })}
        placeholder="Add a caption (optional)"
        aria-label={`Caption for ${name}`}
        className="editor-media-caption"
      />
    </NodeViewWrapper>
  );
}

export const MediaFigure = MediaFigureBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MediaFigureView);
  },
});
