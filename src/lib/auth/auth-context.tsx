"use client";

/**
 * Mock authentication provider.
 *
 * Sessions are local to this browser; when a production auth provider is
 * connected, this context keeps its exact shape and the UI stays untouched.
 */

import * as React from "react";
import type { OnboardingProfile, User, Workspace } from "@/lib/domain/types";
import { readJson, removeKey, writeJson } from "@/lib/storage/local";
import { createId } from "@/lib/utils";

interface Session {
  user: User;
  workspace: Workspace;
}

interface AuthContextValue {
  /** Undefined while the session is being restored on the client. */
  session: Session | null | undefined;
  signIn: (email: string, password: string) => Promise<Session>;
  signUp: (name: string, email: string, password: string) => Promise<Session>;
  signOut: () => void;
  updateUser: (patch: Partial<User>) => void;
  updateWorkspace: (patch: Partial<Workspace>) => void;
  completeOnboarding: (profile: OnboardingProfile) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const SESSION_KEY = "session";

/** Simulated network latency so loading states behave like production. */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveWorkspaceName(name: string) {
  const first = name.trim().split(/\s+/)[0];
  return first ? `${first}'s Studio` : "My Studio";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null | undefined>(undefined);

  React.useEffect(() => {
    setSession(readJson<Session | null>(SESSION_KEY, null));
  }, []);

  const persist = React.useCallback((next: Session | null) => {
    setSession(next);
    if (next) writeJson(SESSION_KEY, next);
    else removeKey(SESSION_KEY);
  }, []);

  const signUp = React.useCallback(
    async (name: string, email: string, _password: string) => {
      void _password; // Validated by the form; a production provider consumes it.
      await delay(700);
      const now = new Date().toISOString();
      const next: Session = {
        user: {
          id: createId("user"),
          name: name.trim(),
          email: email.trim().toLowerCase(),
          onboarded: false,
          createdAt: now,
        },
        workspace: {
          id: createId("ws"),
          name: deriveWorkspaceName(name),
          plan: "pro",
          createdAt: now,
        },
      };
      persist(next);
      return next;
    },
    [persist],
  );

  const signIn = React.useCallback(
    async (email: string, _password: string) => {
      void _password;
      await delay(700);
      const existing = readJson<Session | null>(SESSION_KEY, null);
      if (existing && existing.user.email === email.trim().toLowerCase()) {
        persist(existing);
        return existing;
      }
      const guessedName = email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      const now = new Date().toISOString();
      const next: Session = {
        user: {
          id: createId("user"),
          name: guessedName || "Studio User",
          email: email.trim().toLowerCase(),
          onboarded: false,
          createdAt: now,
        },
        workspace: {
          id: createId("ws"),
          name: deriveWorkspaceName(guessedName),
          plan: "pro",
          createdAt: now,
        },
      };
      persist(next);
      return next;
    },
    [persist],
  );

  const signOut = React.useCallback(() => persist(null), [persist]);

  const updateUser = React.useCallback(
    (patch: Partial<User>) => {
      setSession((current) => {
        if (!current) return current;
        const next = { ...current, user: { ...current.user, ...patch } };
        writeJson(SESSION_KEY, next);
        return next;
      });
    },
    [],
  );

  const updateWorkspace = React.useCallback((patch: Partial<Workspace>) => {
    setSession((current) => {
      if (!current) return current;
      const next = { ...current, workspace: { ...current.workspace, ...patch } };
      writeJson(SESSION_KEY, next);
      return next;
    });
  }, []);

  const completeOnboarding = React.useCallback(
    (profile: OnboardingProfile) => {
      updateUser({ onboarded: true, persona: profile });
    },
    [updateUser],
  );

  const value = React.useMemo(
    () => ({
      session,
      signIn,
      signUp,
      signOut,
      updateUser,
      updateWorkspace,
      completeOnboarding,
    }),
    [session, signIn, signUp, signOut, updateUser, updateWorkspace, completeOnboarding],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
