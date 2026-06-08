import { useState } from "react";
import type { ApiKey, TokenUsage, RequestRecord, ProxyEvent } from "../types";

interface Props {
  keys: ApiKey[];
  selectedKeyId: number | null;
  onSelectKey: (id: number | null) => void;
  usage: TokenUsage[];
  monthlyCost: number;
  recentRequests: RequestRecord[];
  lastEvent: ProxyEvent | null;
  onOpenSettings: () => void;
}

export default function Dashboard({
  keys,
  selectedKeyId,
  onSelectKey,
  usage,
  monthlyCost,
  recentRequests,
  lastEvent,
  onOpenSettings,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const selectedLabel = selectedKeyId
    ? keys.find((k) => k.id === selectedKeyId)?.label ?? "选择 Key"
    : "全部汇总";

  const selectedColor = selectedKeyId
    ? keys.find((k) => k.id === selectedKeyId)?.color ?? "#fbbf24"
    : "#38bdf8";

  // Calculate totals for display
  const totalTokens = usage.reduce((sum, u) => sum + u.total_tokens, 0);
  const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);

  // Current speed (from last event within last few seconds)
  const speed = lastEvent ? lastEvent.total_tokens : 0;

  // Budget calc — uses monthly cost, not today's cost
  const monthlyBudget = selectedKeyId
    ? keys.find((k) => k.id === selectedKeyId)?.monthly_budget ?? 100
    : keys.reduce((sum, k) => sum + (k.monthly_budget ?? 100), 0);
  const budgetPercent = Math.round((monthlyCost / monthlyBudget) * 100);

  // Filter recent requests to selected key
  const filteredRequests = selectedKeyId
    ? recentRequests.filter((r) => r.api_key_id === selectedKeyId)
    : recentRequests;

  return (
    <div className="w-[320px] p-3 pb-4 space-y-2.5 bg-[#0f172a] min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐋</span>
          <span className="text-[13px] font-semibold">Token Dash</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <button
            onClick={async () => {
              try {
                await import("@tauri-apps/api/core").then(({ invoke }) =>
                  invoke("toggle_floating")
                );
              } catch (_) {}
            }}
            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
            title="显示/隐藏悬浮窗"
          >
            📌
          </button>
          <button
            onClick={onOpenSettings}
            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
            title="设置"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Key Selector */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between bg-[#1e293b] rounded-md px-3 py-2 text-[11px] hover:bg-[#273449] transition-colors border border-[#334155]"
        >
          <span className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: selectedColor }}
            />
            {selectedLabel}
          </span>
          <span className="text-[#64748b] text-[10px]">
            {dropdownOpen ? "▲" : "▼"}
          </span>
        </button>
        {dropdownOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e293b] border border-[#334155] rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
            <button
              onClick={() => {
                onSelectKey(null);
                setDropdownOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-[11px] hover:bg-[#273449] flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
              全部汇总
            </button>
            {keys.map((key) => (
              <button
                key={key.id}
                onClick={() => {
                  onSelectKey(key.id);
                  setDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[11px] hover:bg-[#273449] flex items-center gap-2"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: key.color }}
                />
                {key.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Speed Card */}
      <div className="bg-[#1e293b] rounded-lg p-3 text-center border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-1">⚡ 实时速度</div>
        <div className="text-[26px] font-bold text-[#38bdf8] leading-tight">
          {speed > 0
            ? speed >= 1000
              ? `${(speed / 1000).toFixed(1)}k`
              : speed
            : "--"}
          <span className="text-[11px] font-normal text-[#94a3b8]">
            {speed > 0 ? "/次" : ""}
          </span>
        </div>
        {lastEvent && (
          <div className="text-[9px] text-[#64748b] mt-0.5">
            {lastEvent.model} · 刚刚
          </div>
        )}
      </div>

      {/* Three mini cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#1e293b] rounded-lg p-2.5 text-center border border-[#334155]">
          <div className="text-[9px] text-[#64748b]">📊 今日</div>
          <div className="text-[15px] font-bold mt-0.5">
            {totalTokens >= 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens}
          </div>
        </div>
        <div className="bg-[#1e293b] rounded-lg p-2.5 text-center border border-[#334155]">
          <div className="text-[9px] text-[#64748b]">💰 今日</div>
          <div className="text-[15px] font-bold mt-0.5 text-[#a78bfa]">
            ¥{totalCost.toFixed(2)}
          </div>
        </div>
        <div className="bg-[#1e293b] rounded-lg p-2.5 text-center border border-[#334155]">
          <div className="text-[9px] text-[#64748b]">🔔 预算</div>
          <div className="text-[15px] font-bold mt-0.5">
            {Math.min(budgetPercent, 999)}%
          </div>
          <div className="w-full h-1 bg-[#334155] rounded-full mt-1.5">
            <div
              className="h-1 rounded-full transition-all"
              style={{
                width: `${Math.min(budgetPercent, 100)}%`,
                backgroundColor:
                  budgetPercent > 90
                    ? "#ef4444"
                    : budgetPercent > 70
                      ? "#fbbf24"
                      : "#22c55e",
              }}
            />
          </div>
        </div>
      </div>

      {/* Tiny sparkline chart */}
      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-2">
          📈 今日趋势（每小时）
        </div>
        <Sparkline data={usage} />
      </div>

      {/* Per-key summary */}
      {!selectedKeyId && usage.length > 0 && (
        <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
          <div className="text-[10px] text-[#94a3b8] mb-2">
            📋 各 Key 今日消耗
          </div>
          {usage.map((u) => (
            <div
              key={u.api_key_id}
              className="flex items-center justify-between py-1.5 text-[11px] border-b border-[#1e293b] last:border-0"
            >
              <span className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ backgroundColor: u.color }}
                />
                {u.label}
              </span>
              <span className="text-[#38bdf8]">
                {u.total_tokens >= 1000
                  ? `${(u.total_tokens / 1000).toFixed(1)}k`
                  : u.total_tokens}
              </span>
              <span className="text-[#a78bfa] w-14 text-right">
                ¥{u.cost.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent requests */}
      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-2">📋 最近请求</div>
        {filteredRequests.length === 0 && (
          <div className="text-[10px] text-[#64748b] text-center py-4">
            暂无请求记录
            <br />
            启动代理后将自动采集
          </div>
        )}
        {filteredRequests.slice(0, 5).map((r) => {
          const key = keys.find((k) => k.id === r.api_key_id);
          return (
            <div
              key={r.id}
              className="flex items-center justify-between py-1.5 text-[10px] border-b border-[#1e293b] last:border-0"
            >
              <span className="flex items-center gap-1.5 max-w-[100px] truncate">
                {!selectedKeyId && key && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: key.color }}
                  />
                )}
                <span className="truncate">{r.model}</span>
              </span>
              <span className="text-[#38bdf8]">
                {r.total_tokens >= 1000
                  ? `${(r.total_tokens / 1000).toFixed(1)}k`
                  : r.total_tokens}
              </span>
              <span className="text-[#a78bfa] w-10 text-right">
                ¥{r.cost.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: TokenUsage[] }) {
  // Simplified sparkline — in prod we'd use real hourly breakdown
  const total = data.reduce((s, u) => s + u.total_tokens, 0);
  if (total === 0)
    return (
      <div className="text-[10px] text-[#64748b] text-center py-4">
        暂无数据
      </div>
    );

  // Generate sample bars based on total
  const bars = 12;
  const maxH = 48;

  return (
    <div className="flex items-end gap-[2px] h-[48px] px-1">
      {Array.from({ length: bars }).map((_, i) => {
        const seed = Math.sin(i * 1.3 + 0.5) * 0.5 + 0.5;
        const h = Math.max(8, seed * maxH * Math.min(1, total / 50000));
        return (
          <div
            key={i}
            className="flex-1 bg-[#38bdf8] rounded-[1px] opacity-60"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}
