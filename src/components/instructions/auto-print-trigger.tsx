"use client";

import { useEffect } from "react";

interface AutoPrintTriggerProps {
  enabled: boolean;
  waitForSelector?: string;
}

export function AutoPrintTrigger({ enabled, waitForSelector }: AutoPrintTriggerProps) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let canceled = false;

    const waitForMediaReady = async () => {
      if (!waitForSelector) {
        return;
      }

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (canceled) {
          return;
        }

        const hasMedia = Boolean(
          document.querySelector(`${waitForSelector} img, ${waitForSelector} video`),
        );
        if (hasMedia) {
          break;
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 100);
        });
      }

      if (canceled) {
        return;
      }

      const mediaRoot = document.querySelector<HTMLElement>(waitForSelector);
      if (!mediaRoot) {
        return;
      }

      const imageElements = Array.from(mediaRoot.querySelectorAll("img"));
      const videoElements = Array.from(mediaRoot.querySelectorAll("video"));
      const imageSources = imageElements
        .map((imageElement) => imageElement.currentSrc || imageElement.getAttribute("src")?.trim() || "")
        .filter((source) => source.length > 0);

      const preloadImageSource = (source: string) =>
        new Promise<void>((resolve) => {
          const preloadImage = new Image();
          preloadImage.decoding = "sync";
          preloadImage.onload = () => resolve();
          preloadImage.onerror = () => resolve();
          preloadImage.src = source;
        });

      const preloadImages =
        imageSources.length === 0
          ? Promise.resolve()
          : Promise.all(imageSources.map((source) => preloadImageSource(source))).then(() => undefined);

      imageElements.forEach((imageElement) => {
        imageElement.loading = "eager";
        imageElement.decoding = "sync";
      });

      const imagePromises = imageElements.map((imageElement) => {
        if (imageElement.complete && imageElement.naturalWidth > 0) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          const finish = () => resolve();
          imageElement.addEventListener("load", finish, { once: true });
          imageElement.addEventListener("error", finish, { once: true });
        });
      });

      const videoPromises = videoElements.map((videoElement) => {
        if (videoElement.readyState >= 2) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          const finish = () => resolve();
          videoElement.addEventListener("loadeddata", finish, { once: true });
          videoElement.addEventListener("canplay", finish, { once: true });
          videoElement.addEventListener("error", finish, { once: true });
        });
      });

      const waitForAllMedia = Promise.all([preloadImages, ...imagePromises, ...videoPromises]).then(() => undefined);
      const timeout = new Promise<void>((resolve) => {
        window.setTimeout(resolve, 4500);
      });

      await Promise.race([waitForAllMedia, timeout]);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 120);
      });
    };

    void (async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 180);
      });

      if (canceled) {
        return;
      }

      await waitForMediaReady();
      if (canceled) {
        return;
      }

      window.print();
    })();

    return () => {
      canceled = true;
    };
  }, [enabled, waitForSelector]);

  return null;
}
