"use client";

import { useEffect } from "react";

interface PrintMediaIsolatorProps {
  mode?: "paginate-inline" | "append-to-end";
  proseSelector?: string;
  destinationSelector?: string;
}

const MEDIA_BLOCK_CLASS = "print-media-block";
const INLINE_HIDDEN_CLASS = "print-media-inline-hidden";
const END_ITEM_CLASS = "print-media-end-item";
const END_SECTION_CLASS = "print-media-end-section";
const DEFAULT_PROSE_SELECTOR = ".prose, .prose-markdown";

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
  mode = "paginate-inline",
  proseSelector = DEFAULT_PROSE_SELECTOR,
  destinationSelector,
}: PrintMediaIsolatorProps = {}) {
  useEffect(() => {
    function getContainers() {
      return Array.from(document.querySelectorAll<HTMLElement>(proseSelector));
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

      destination.replaceChildren();
      const seenBlocks = new Set<HTMLElement>();
      let hasMedia = false;

      containers.forEach((container) => {
        container.querySelectorAll<HTMLElement>("img, video").forEach((mediaElement) => {
          const sourceBlock = resolveMediaBlock(container, mediaElement);
          if (seenBlocks.has(sourceBlock)) {
            return;
          }
          seenBlocks.add(sourceBlock);
          sourceBlock.classList.add(INLINE_HIDDEN_CLASS);

          const mediaClone = mediaElement.cloneNode(true);
          if (!(mediaClone instanceof HTMLElement)) {
            return;
          }

          const figureElement = document.createElement("figure");
          figureElement.className = END_ITEM_CLASS;
          figureElement.append(mediaClone);

          const caption = getMediaCaption(sourceBlock, mediaElement);
          if (caption) {
            const captionElement = document.createElement("figcaption");
            captionElement.className = "print-media-end-caption";
            captionElement.textContent = caption;
            figureElement.append(captionElement);
          }

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
      const containers = getContainers();
      resetMarkedState(containers);

      if (mode === "append-to-end") {
        appendMediaToEnd(containers);
        return;
      }

      markMediaBlocks(containers);
    }

    prepareMediaForPrint();
    window.addEventListener("beforeprint", prepareMediaForPrint);
    return () => {
      window.removeEventListener("beforeprint", prepareMediaForPrint);

      const containers = getContainers();
      resetMarkedState(containers);

      if (destinationSelector) {
        const destination = document.querySelector<HTMLElement>(destinationSelector);
        if (destination) {
          destination.replaceChildren();
          const mediaSection = destination.closest<HTMLElement>(`.${END_SECTION_CLASS}`);
          if (mediaSection) {
            mediaSection.dataset.hasMedia = "false";
          }
        }
      }
    };
  }, [destinationSelector, mode, proseSelector]);

  return null;
}
