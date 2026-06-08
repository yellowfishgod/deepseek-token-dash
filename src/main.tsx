import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import FloatingWidget from "./components/FloatingWidget";

function Root() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        setLabel(getCurrentWindow().label);
      })
      .catch(() => {
        setLabel("main"); // fallback for browser dev
      });
  }, []);

  if (label === null) return null;

  if (label === "floating") {
    return <FloatingWidget />;
  }

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
