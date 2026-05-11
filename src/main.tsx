import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { SupabaseAuthProvider } from "./lib/supabase/auth";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SupabaseAuthProvider>
      <App />
    </SupabaseAuthProvider>
  </React.StrictMode>,
);
