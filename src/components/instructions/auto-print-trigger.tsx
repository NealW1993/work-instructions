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

      const imagePromises = Array.from(mediaRoot.querySelectorAll("img")).map((imageElement) => {
        if (imageElement.complete) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          const finish = () => resolve();
          imageElement.addEventListener("load", finish, { once: true });
          imageElement.addEventListener("error", finish, { once: true });
        });
      });

      const videoPromises = Array.from(mediaRoot.querySelectorAll("video")).map((videoElement) => {
        if (videoElement.readyState >= 2) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          const finish = () => resolve();
          videoElement.addEventListener("loadeddata", finish, { once: true });
          videoElement.addEventListener("error", finish, { once: true });
        });
      });

      const waitForAllMedia = Promise.all([...imagePromises, ...videoPromises]).then(() => undefined);
      const timeout = new Promise<void>((resolve) => {
        window.setTimeout(resolve, 2200);
      });

      await Promise.race([waitForAllMedia, timeout]);
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
