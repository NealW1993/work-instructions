"use client";

import { useEffect } from "react";

export function PrintMediaIsolator() {
  useEffect(() => {
    function markMediaBlocks() {
      document.querySelectorAll(".prose").forEach((proseEl) => {
        Array.from(proseEl.children).forEach((child) => {
          if (child.querySelector("img, video")) {
            child.classList.add("print-media-block");
          }
        });
      });
    }

    markMediaBlocks();
    window.addEventListener("beforeprint", markMediaBlocks);
    return () => window.removeEventListener("beforeprint", markMediaBlocks);
  }, []);

  return null;
}
