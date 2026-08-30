"use client";

/**
 * Session persistence as an external store (localStorage-backed).
 * `undefined` while restoring on the client boot pass; `null` signed out.
 */

import type { User, Workspace } from "@/lib/domain/types";
import { readJson, removeKey, writeJson } from "@/lib/storage/local";

export interface Session {
  user: User;
  workspace: Workspace;
}

const SESSION_KEY = "session";

let current: Session | null | undefined = undefined;
let initialized = false;
const listeners = new Set<() => void>();

function init() {
  if (!initialized && typeof window !== "undefined") {
    current = readJson<Session | null>(SESSION_KEY, null);
    initialized = true;
  }
}

export const sessionStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): Session | null | undefined {
    init();
    return current;
  },
  getServerSnapshot(): Session | null | undefined {
    return undefined;
  },
  set(next: Session | null) {
    init();
    current = next;
    if (next) writeJson(SESSION_KEY, next);
    else removeKey(SESSION_KEY);
    listeners.forEach((listener) => listener());
  },
  read(): Session | null {
    init();
    return current ?? null;
  },
};
