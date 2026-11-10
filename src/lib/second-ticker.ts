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
  // A stable value is required both on the server and the first hydration pass.
  return 0;
}

export function useSynchronizedNowMs() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getMinuteSnapshot() {
  return Math.floor(currentNowMs / 60000) * 60000;
}

/** Dashboard date windows update each minute rather than rerendering each second. */
export function useSynchronizedMinuteMs() {
  return useSyncExternalStore(subscribe, getMinuteSnapshot, getServerSnapshot);
}
