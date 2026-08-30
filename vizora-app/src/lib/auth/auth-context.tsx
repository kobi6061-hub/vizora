"use client";

/**
 * Mock authentication provider.
 *
 * Sessions are local to this browser; when a production auth provider is
 * connected, this context keeps its exact shape and the UI stays untouched.
 */

import * as React from "react";
import type { OnboardingProfile, User, Workspace } from "@/lib/domain/types";
import { sessionStore, type Session } from "@/lib/auth/session-store";
import { createId } from "@/lib/utils";

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

/** Simulated network latency so loading states behave like production. */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveWorkspaceName(name: string) {
  const first = name.trim().split(/\s+/)[0];
  return first ? `${first}'s Studio` : "My Studio";
}

function buildSession(name: string, email: string): Session {
  const now = new Date().toISOString();
  return {
    user: {
      id: createId("user"),
      name: name.trim() || "Studio User",
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
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );

  const signUp = React.useCallback(async (name: string, email: string, _password: string) => {
    void _password; // Validated by the form; a production provider consumes it.
    await delay(700);
    const next = buildSession(name, email);
    sessionStore.set(next);
    return next;
  }, []);

  const signIn = React.useCallback(async (email: string, _password: string) => {
    void _password;
    await delay(700);
    const existing = sessionStore.read();
    if (existing && existing.user.email === email.trim().toLowerCase()) {
      sessionStore.set(existing);
      return existing;
    }
    const guessedName = email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    const next = buildSession(guessedName, email);
    sessionStore.set(next);
    return next;
  }, []);

  const signOut = React.useCallback(() => sessionStore.set(null), []);

  const updateUser = React.useCallback((patch: Partial<User>) => {
    const currentSession = sessionStore.read();
    if (!currentSession) return;
    sessionStore.set({
      ...currentSession,
      user: { ...currentSession.user, ...patch },
    });
  }, []);

  const updateWorkspace = React.useCallback((patch: Partial<Workspace>) => {
    const currentSession = sessionStore.read();
    if (!currentSession) return;
    sessionStore.set({
      ...currentSession,
      workspace: { ...currentSession.workspace, ...patch },
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
