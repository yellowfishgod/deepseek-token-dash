import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ApiKey, TokenUsage, RequestRecord, ProxyEvent, Page } from "./types";
import Dashboard from "./components/Dashboard";
import SettingsPage from "./components/SettingsPage";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [usage, setUsage] = useState<TokenUsage[]>([]);
  const [recentRequests, setRecentRequests] = useState<RequestRecord[]>([]);
  const [lastEvent, setLastEvent] = useState<ProxyEvent | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const result = await invoke<ApiKey[]>("get_api_keys");
      setKeys(result);
    } catch (e) {
      console.error("Failed to load keys:", e);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const result = await invoke<TokenUsage[]>("get_usage_summary", {
        apiKeyId: selectedKeyId ?? null,
        period: "today",
      });
      setUsage(result);
    } catch (e) {
      console.error("Failed to load usage:", e);
    }
  }, [selectedKeyId]);

  const loadRecentRequests = useCallback(async () => {
    try {
      const result = await invoke<RequestRecord[]>("get_recent_requests", {
        limit: 10,
      });
      setRecentRequests(result);
    } catch (e) {
      console.error("Failed to load recent requests:", e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    loadUsage();
    loadRecentRequests();
  }, [loadUsage, loadRecentRequests]);

  // Listen for real-time token events from proxy
  useEffect(() => {
    const unlisten = listen<ProxyEvent>("token-usage", (event) => {
      setLastEvent(event.payload);
      loadUsage();
      loadRecentRequests();
      loadKeys(); // refresh in case of auto-registered key
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadUsage, loadRecentRequests, loadKeys]);

  return (
    <div className="min-h-screen text-[#e2e8f0] font-sans">
      {page === "dashboard" && (
        <Dashboard
          keys={keys}
          selectedKeyId={selectedKeyId}
          onSelectKey={setSelectedKeyId}
          usage={usage}
          recentRequests={recentRequests}
          lastEvent={lastEvent}
          onOpenSettings={() => setPage("settings")}
        />
      )}
      {page === "settings" && (
        <SettingsPage
          keys={keys}
          onKeysChanged={loadKeys}
          onBack={() => setPage("dashboard")}
        />
      )}
    </div>
  );
}

export default App;
