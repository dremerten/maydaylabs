"use client";
import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initCodeClient: (config: object) => { requestCode: () => void };
        };
      };
    };
  }
}

export default function GoogleSignInButton() {
  const { refreshAuth } = useAuth();
  const clientRef = useRef<{ requestCode: () => void } | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      clientRef.current = window.google.accounts.oauth2.initCodeClient({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        scope: "openid email profile",
        ux_mode: "popup",
        callback: async (response: { code: string }) => {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/api/auth/google`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                code: response.code,
                redirect_uri: window.location.origin,
              }),
            }
          );
          if (res.ok) await refreshAuth();
        },
      });
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [refreshAuth]);

  return (
    <button
      onClick={() => clientRef.current?.requestCode()}
      className="flex items-center gap-3 px-6 py-3 bg-white text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition-colors"
    >
      <svg width="20" height="20" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Sign in with Google
    </button>
  );
}
