"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/** Server markup stays deterministic; browser-only views appear after hydration. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
