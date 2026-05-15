import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthProvider, useSupabaseAuth, sanitizeAuthUrl } from "./auth";

const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const signInWithOtp = vi.fn();
const signOut = vi.fn();

vi.mock("./client", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      signOut: (...args: unknown[]) => signOut(...args),
    },
  }),
  isSupabaseConfigured: () => true,
}));

const Probe = () => {
  const auth = useSupabaseAuth();
  return <div>{auth.loading ? "loading" : auth.user ? "authed" : "anon"}</div>;
};

describe("supabase auth url sanitization", () => {
  beforeEach(() => {
    getSession.mockReset();
    onAuthStateChange.mockReset();
    signInWithOtp.mockReset();
    signOut.mockReset();

    window.history.replaceState(
      null,
      "",
      "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=",
    );
  });

  it("removes auth hash fragments directly", () => {
    sanitizeAuthUrl();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/");
  });

  it("clears auth callback fragments after bootstrap when already signed in", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-1",
          },
        },
      },
      error: null,
    });
    onAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });

    render(
      <SupabaseAuthProvider>
        <Probe />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("authed")).toBeInTheDocument();
    });

    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/");
  });
});
