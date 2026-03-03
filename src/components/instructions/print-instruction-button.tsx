"use client";

import { ChevronDown, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  PRINT_MEDIA_MODE_ATTRIBUTE,
  PRINT_MEDIA_MODE_EVENT,
  type PrintMediaMode,
} from "@/components/instructions/print-media-isolator";

import { cn } from "@/lib/utils";

interface PrintInstructionButtonProps {
  className?: string;
}

export function PrintInstructionButton({
  className,
}: PrintInstructionButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activePrintModeRef = useRef<PrintMediaMode>("paginate-inline");

  useEffect(() => {
    const handleBeforePrint = () => {
      const mode = activePrintModeRef.current;
      document.documentElement.setAttribute(PRINT_MEDIA_MODE_ATTRIBUTE, mode);
      window.dispatchEvent(new Event(PRINT_MEDIA_MODE_EVENT));
    };

    window.addEventListener("beforeprint", handleBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!menuRef.current || !target || menuRef.current.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function waitForMediaReadyForPrint(mode: PrintMediaMode) {
    if (mode !== "append-to-end") {
      return;
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    const mediaRoot = document.querySelector<HTMLElement>(".print-media-end-target");
    if (!mediaRoot) {
      return;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const hasMedia = Boolean(document.querySelector(".print-media-end-target img, .print-media-end-target video"));
      if (hasMedia) {
        break;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 100);
      });
    }

    const imageElements = Array.from(mediaRoot.querySelectorAll("img"));
    const videoElements = Array.from(mediaRoot.querySelectorAll("video"));
    if (imageElements.length === 0 && videoElements.length === 0) {
      return;
    }

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

    const preloadVideos =
      videoElements.length === 0
        ? Promise.resolve()
        : Promise.all(
            videoElements.map(
              (videoElement) =>
                new Promise<void>((resolve) => {
                  videoElement.preload = "auto";
                  if (videoElement.readyState >= 2) {
                    resolve();
                    return;
                  }

                  const finish = () => resolve();
                  videoElement.addEventListener("loadeddata", finish, { once: true });
                  videoElement.addEventListener("canplay", finish, { once: true });
                  videoElement.addEventListener("error", finish, { once: true });
                  videoElement.load();
                }),
            ),
          ).then(() => undefined);

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

    const waitForAllMedia = Promise.all([
      preloadImages,
      preloadVideos,
      ...imagePromises,
      ...videoPromises,
    ]).then(() => undefined);
    const timeout = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 4500);
    });

    await Promise.race([waitForAllMedia, timeout]);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });
  }

  async function printWithMode(mode: PrintMediaMode) {
    activePrintModeRef.current = mode;
    document.documentElement.setAttribute(PRINT_MEDIA_MODE_ATTRIBUTE, mode);
    window.dispatchEvent(new Event(PRINT_MEDIA_MODE_EVENT));
    setOpen(false);

    await waitForMediaReadyForPrint(mode);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 180);
    });
    window.print();
  }

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-xl border border-sky-500/35 bg-sky-500/12 px-3 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-500/20 dark:text-sky-100",
        )}
      >
        <span className="inline-flex items-center gap-2">
          <Printer size={14} />
          Print
        </span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 grid min-w-48 gap-1 rounded-xl border border-slate-300 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-950"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => printWithMode("paginate-inline")}
            className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Print Media Inline
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => printWithMode("append-to-end")}
            className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Print Media At End
          </button>
        </div>
      ) : null}
    </div>
  );
}
