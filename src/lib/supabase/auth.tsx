import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { AuthState } from "./types";
import { getSupabaseClient, isSupabaseConfigured } from "./client";

type AuthContextValue = AuthState & {
  signInWithMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const defaultState: AuthState = {
  session: null,
  user: null,
  loading: true,
  error: null,
  isConfigured: isSupabaseConfigured(),
};

const AUTH_HASH_KEYS = new Set([
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "token_type",
  "type",
  "error",
  "error_code",
  "error_description",
  "provider_token",
  "provider_refresh_token",
  "code",
  "sb",
]);

const AUTH_QUERY_KEYS = new Set([
  "code",
  "error",
  "error_code",
  "error_description",
  "sb",
]);

export const sanitizeAuthUrl = () => {
  const url = new URL(window.location.href);
  let changed = false;

  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash.length > 0) {
    const hashParams = new URLSearchParams(hash);
    const keys = [...hashParams.keys()];
    if (keys.some((key) => AUTH_HASH_KEYS.has(key))) {
      url.hash = "";
      changed = true;
    }
  }

  AUTH_QUERY_KEYS.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  if (!changed) {
    return;
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
};

export const SupabaseAuthProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<AuthState>(defaultState);

  useEffect(() => {
    const client = getSupabaseClient();

    if (!client) {
      setState({
        session: null,
        user: null,
        loading: false,
        error: null,
        isConfigured: false,
      });
      return;
    }

    let active = true;

    const bootstrap = async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (!active) {
          return;
        }

        setState({
          session: data.session,
          user: data.session?.user ?? null,
          loading: false,
          error: error?.message ?? null,
          isConfigured: true,
        });
        sanitizeAuthUrl();
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          session: null,
          user: null,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to verify your session.",
          isConfigured: true,
        });
        sanitizeAuthUrl();
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }

      setState((current) => ({
        ...current,
        session,
        user: session?.user ?? null,
        loading: false,
        error: null,
        isConfigured: true,
      }));
      sanitizeAuthUrl();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      ...state,
      signInWithMagicLink: async (email: string) => {
        const client = getSupabaseClient();
        if (!client) {
          throw new Error("Supabase is not configured.");
        }

        const { error } = await client.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) {
          throw error;
        }
      },
      signOut: async () => {
        const client = getSupabaseClient();
        if (!client) {
          return;
        }

        const { error } = await client.auth.signOut();
        if (error) {
          setState((current) => ({ ...current, error: error.message }));
          throw error;
        }

        setState((current) => ({
          ...current,
          session: null,
          user: null,
          error: null,
        }));
      },
    };
  }, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useSupabaseAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider.");
  }

  return context;
};
