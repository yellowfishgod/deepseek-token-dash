import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TokenUsage, ProxyEvent } from "../types";

export default function FloatingWidget() {
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [lastEvent, setLastEvent] = useState<ProxyEvent | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      const result = await invoke<TokenUsage[]>("get_usage_summary", {
        apiKeyId: null,
        period: "today",
      });
      const t = result.reduce((s, u) => s + u.total_tokens, 0);
      const c = result.reduce((s, u) => s + u.cost, 0);
      setTotalTokens(t);
      setTotalCost(c);
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => {
    loadUsage();
    const interval = setInterval(loadUsage, 5000);
    return () => clearInterval(interval);
  }, [loadUsage]);

  // Listen for events from Tauri
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ProxyEvent>("token-usage", (event) => {
        setLastEvent(event.payload);
        loadUsage();
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadUsage]);

  return (
    <div
      className="h-screen flex items-center justify-center select-none cursor-move"
      style={{
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderRadius: "12px",
        border: "1px solid rgba(51, 65, 85, 0.5)",
      }}
      data-tauri-drag-region
    >
      <div className="text-center px-3 py-2">
        <div className="text-[18px] font-bold text-[#38bdf8] leading-tight">
          {lastEvent
            ? lastEvent.total_tokens >= 1000
              ? `${(lastEvent.total_tokens / 1000).toFixed(1)}k`
              : lastEvent.total_tokens
            : totalTokens >= 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens}
          <span className="text-[10px] font-normal text-[#94a3b8]">
            {lastEvent ? "/次" : " 今日"}
          </span>
        </div>
        <div className="text-[9px] text-[#94a3b8] mt-0.5">
          今日 ¥{totalCost.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
