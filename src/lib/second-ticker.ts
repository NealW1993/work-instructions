"use client";

import { useSyncExternalStore } from "react";

type Listener = () => void;

let currentNowMs = Date.now();
let alignedTimeout: number | null = null;
let intervalId: number | null = null;
const listeners = new Set<Listener>();

function notifyListeners() {
  currentNowMs = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function stopTicker() {
  if (typeof window === "undefined") {
    return;
  }

  if (alignedTimeout !== null) {
    window.clearTimeout(alignedTimeout);
    alignedTimeout = null;
  }

  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

function startTicker() {
  if (typeof window === "undefined") {
    return;
  }

  if (alignedTimeout !== null || intervalId !== null) {
    return;
  }

  notifyListeners();

  const msUntilNextSecond = 1000 - (Date.now() % 1000);
  const delay = msUntilNextSecond === 1000 ? 0 : msUntilNextSecond;

  alignedTimeout = window.setTimeout(() => {
    alignedTimeout = null;
    notifyListeners();
    intervalId = window.setInterval(() => {
      notifyListeners();
    }, 1000);
  }, delay);
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  startTicker();

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      stopTicker();
    }
  };
}

function getSnapshot() {
  return currentNowMs;
}

function getServerSnapshot() {
  return Date.now();
}

export function useSynchronizedNowMs() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
