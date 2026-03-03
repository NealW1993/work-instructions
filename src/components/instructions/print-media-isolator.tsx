"use client";

import { useEffect } from "react";

export type PrintMediaMode = "paginate-inline" | "append-to-end";

interface PrintMediaIsolatorProps {
  mode?: PrintMediaMode | "from-document";
  proseSelector?: string;
  inlineProseSelector?: string;
  appendProseSelector?: string;
  destinationSelector?: string;
}

const MEDIA_BLOCK_CLASS = "print-media-block";
const INLINE_HIDDEN_CLASS = "print-media-inline-hidden";
const END_ITEM_CLASS = "print-media-end-item";
const END_SECTION_CLASS = "print-media-end-section";
const DEFAULT_PROSE_SELECTOR = ".prose, .prose-markdown";
export const PRINT_MEDIA_MODE_ATTRIBUTE = "data-print-media-mode";
export const PRINT_MEDIA_MODE_EVENT = "print-media-mode-change";

function normalizePrintMode(value: string | null | undefined): PrintMediaMode {
  if (value === "append-to-end" || value === "end") {
    return "append-to-end";
  }

  return "paginate-inline";
}

function resolveMediaBlock(container: HTMLElement, mediaElement: HTMLElement) {
  const figureBlock = mediaElement.closest("figure");
  if (figureBlock instanceof HTMLElement && container.contains(figureBlock)) {
    return figureBlock;
  }

  const paragraphBlock = mediaElement.closest("p");
  if (
    paragraphBlock instanceof HTMLElement &&
    container.contains(paragraphBlock) &&
    (paragraphBlock.textContent ?? "").trim().length === 0
  ) {
    return paragraphBlock;
  }

  return mediaElement;
}

function getMediaCaption(sourceBlock: HTMLElement, mediaElement: HTMLElement) {
  if (sourceBlock.tagName === "FIGURE") {
    const figureCaption = sourceBlock.querySelector("figcaption")?.textContent?.trim();
    if (figureCaption) {
      return figureCaption;
    }
  }

  const parentFigure = mediaElement.closest("figure");
  if (parentFigure instanceof HTMLElement) {
    const figureCaption = parentFigure.querySelector("figcaption")?.textContent?.trim();
    if (figureCaption) {
      return figureCaption;
    }
  }

  if (mediaElement instanceof HTMLImageElement) {
    const altText = mediaElement.alt.trim();
    if (altText) {
      return altText;
    }
  }

  return null;
}

export function PrintMediaIsolator({
  mode = "from-document",
  proseSelector = DEFAULT_PROSE_SELECTOR,
  inlineProseSelector,
  appendProseSelector,
  destinationSelector,
}: PrintMediaIsolatorProps = {}) {
  useEffect(() => {
    const resolvedInlineSelector = inlineProseSelector ?? proseSelector;
    const resolvedAppendSelector = appendProseSelector ?? proseSelector;

    function resolveActiveMode(): PrintMediaMode {
      if (mode === "append-to-end" || mode === "paginate-inline") {
        return mode;
      }

      return normalizePrintMode(document.documentElement.getAttribute(PRINT_MEDIA_MODE_ATTRIBUTE));
    }

    function getContainers(selector: string) {
      return Array.from(document.querySelectorAll<HTMLElement>(selector));
    }

    function getAllContainers() {
      const uniqueContainers = new Set<HTMLElement>();
      getContainers(resolvedInlineSelector).forEach((container) => uniqueContainers.add(container));
      getContainers(resolvedAppendSelector).forEach((container) => uniqueContainers.add(container));
      return Array.from(uniqueContainers);
    }

    function clearDestination() {
      if (!destinationSelector) {
        return;
      }

      const destination = document.querySelector<HTMLElement>(destinationSelector);
      if (!destination) {
        return;
      }

      destination.replaceChildren();
      const mediaSection = destination.closest<HTMLElement>(`.${END_SECTION_CLASS}`);
      if (mediaSection) {
        mediaSection.dataset.hasMedia = "false";
      }
    }

    function resetMarkedState(containers: HTMLElement[]) {
      containers.forEach((container) => {
        container
          .querySelectorAll<HTMLElement>(`.${MEDIA_BLOCK_CLASS}, .${INLINE_HIDDEN_CLASS}`)
          .forEach((block) => {
            block.classList.remove(MEDIA_BLOCK_CLASS, INLINE_HIDDEN_CLASS);
          });
      });
    }

    function stripMarkerClasses(node: HTMLElement) {
      node.classList.remove(MEDIA_BLOCK_CLASS, INLINE_HIDDEN_CLASS);
      node
        .querySelectorAll<HTMLElement>(`.${MEDIA_BLOCK_CLASS}, .${INLINE_HIDDEN_CLASS}`)
        .forEach((element) => {
          element.classList.remove(MEDIA_BLOCK_CLASS, INLINE_HIDDEN_CLASS);
        });
    }

    function markMediaBlocks(containers: HTMLElement[]) {
      containers.forEach((container) => {
        const blocks = new Set<HTMLElement>();
        container.querySelectorAll<HTMLElement>("img, video").forEach((mediaElement) => {
          blocks.add(resolveMediaBlock(container, mediaElement));
        });

        blocks.forEach((block) => {
          block.classList.add(MEDIA_BLOCK_CLASS);
        });
      });
    }

    function appendMediaToEnd(containers: HTMLElement[]) {
      if (!destinationSelector) {
        return;
      }

      const destination = document.querySelector<HTMLElement>(destinationSelector);
      if (!destination) {
        return;
      }

      clearDestination();
      const seenMedia = new Set<string>();
      let hasMedia = false;

      containers.forEach((container) => {
        container.querySelectorAll<HTMLElement>("img, video").forEach((mediaElement) => {
          const sourceBlock = resolveMediaBlock(container, mediaElement);
          const caption = getMediaCaption(sourceBlock, mediaElement) ?? "";
          const src = mediaElement.getAttribute("src")?.trim() ?? "";
          const signature = `${mediaElement.tagName.toLowerCase()}|${src}|${caption}`;
          if (seenMedia.has(signature)) {
            return;
          }
          seenMedia.add(signature);
          sourceBlock.classList.add(INLINE_HIDDEN_CLASS);

          const sourceClone = sourceBlock.cloneNode(true);
          if (!(sourceClone instanceof HTMLElement)) {
            return;
          }
          stripMarkerClasses(sourceClone);

          let figureElement: HTMLElement;
          if (sourceClone.tagName === "FIGURE") {
            figureElement = sourceClone;
          } else {
            figureElement = document.createElement("figure");
            figureElement.append(sourceClone);
          }

          figureElement.classList.add(END_ITEM_CLASS);

          if (!figureElement.querySelector("img, video")) {
            return;
          }

          if (caption && !figureElement.querySelector("figcaption")) {
            const captionElement = document.createElement("figcaption");
            captionElement.className = "print-media-end-caption";
            captionElement.textContent = caption;
            figureElement.append(captionElement);
          }

          figureElement.querySelectorAll("img").forEach((imageElement) => {
            imageElement.loading = "eager";
            imageElement.decoding = "sync";
          });
          figureElement.querySelectorAll("video").forEach((videoElement) => {
            videoElement.preload = "auto";
          });

          destination.append(figureElement);
          hasMedia = true;
        });
      });

      const mediaSection = destination.closest<HTMLElement>(`.${END_SECTION_CLASS}`);
      if (mediaSection) {
        mediaSection.dataset.hasMedia = hasMedia ? "true" : "false";
      }
    }

    function prepareMediaForPrint() {
      const activeMode = resolveActiveMode();
      const allContainers = getAllContainers();
      resetMarkedState(allContainers);
      const inlineContainers = getContainers(resolvedInlineSelector);
      markMediaBlocks(inlineContainers);

      if (activeMode === "append-to-end") {
        const appendContainers = getContainers(resolvedAppendSelector);
        appendMediaToEnd(appendContainers);
        return;
      }

      clearDestination();
    }

    prepareMediaForPrint();
    window.addEventListener("beforeprint", prepareMediaForPrint);
    window.addEventListener(PRINT_MEDIA_MODE_EVENT, prepareMediaForPrint);
    return () => {
      window.removeEventListener("beforeprint", prepareMediaForPrint);
      window.removeEventListener(PRINT_MEDIA_MODE_EVENT, prepareMediaForPrint);
      resetMarkedState(getAllContainers());
      clearDestination();
    };
  }, [appendProseSelector, destinationSelector, inlineProseSelector, mode, proseSelector]);

  return null;
}
