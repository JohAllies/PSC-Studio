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
          setState((current) => ({ ...current, error: error.message }));
          throw error;
        }

        setState((current) => ({ ...current, error: null }));
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
