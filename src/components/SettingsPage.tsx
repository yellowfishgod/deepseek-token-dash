import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiKey, SettingsTab, ModelPricing } from "../types";

interface Props {
  keys: ApiKey[];
  onKeysChanged: () => void;
  onBack: () => void;
}

const TABS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "budget", label: "预算", icon: "💰" },
  { key: "pricing", label: "价格", icon: "🏷️" },
  { key: "keys", label: "Key", icon: "🔑" },
  { key: "proxy", label: "代理", icon: "⚙️" },
];

const COLORS = ["#fbbf24", "#a78bfa", "#22c55e", "#38bdf8", "#ef4444", "#f472b6"];

export default function SettingsPage({ keys, onKeysChanged, onBack }: Props) {
  const [tab, setTab] = useState<SettingsTab>("budget");
  const [showAddKey, setShowAddKey] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);

  const handleAddKey = async () => {
    if (!newLabel.trim() || !newKey.trim()) return;
    try {
      await invoke("add_api_key", {
        label: newLabel.trim(),
        apiKey: newKey.trim(),
        color: newColor,
      });
      setShowAddKey(false);
      setNewLabel("");
      setNewKey("");
      setNewColor(COLORS[0]);
      onKeysChanged();
    } catch (e) {
      console.error("Failed to add key:", e);
    }
  };

  const handleDeleteKey = async (id: number) => {
    try {
      await invoke("delete_api_key", { id });
      onKeysChanged();
    } catch (e) {
      console.error("Failed to delete key:", e);
    }
  };

  return (
    <div className="w-[320px] p-3 pb-4 space-y-3 bg-[#0f172a] min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-[#64748b] hover:text-[#94a3b8] text-[14px]"
        >
          ←
        </button>
        <span className="text-[13px] font-semibold">设置</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1e293b] rounded-lg p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-[10px] py-1.5 rounded-md transition-colors ${
              tab === t.key
                ? "bg-[#0f172a] text-[#e2e8f0]"
                : "text-[#64748b] hover:text-[#94a3b8]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-2.5">
        {tab === "budget" && <BudgetTab />}
        {tab === "pricing" && <PricingTab />}
        {tab === "keys" && (
          <KeysTab
            keys={keys}
            showAddKey={showAddKey}
            setShowAddKey={setShowAddKey}
            newLabel={newLabel}
            setNewLabel={setNewLabel}
            newKey={newKey}
            setNewKey={setNewKey}
            newColor={newColor}
            setNewColor={setNewColor}
            colors={COLORS}
            onAdd={handleAddKey}
            onDelete={handleDeleteKey}
          />
        )}
        {tab === "proxy" && <ProxyTab />}
      </div>
    </div>
  );
}

function BudgetTab() {
  const [budget, setBudget] = useState("100");
  const [threshold, setThreshold] = useState(80);
  const [period, setPeriod] = useState("monthly");

  useEffect(() => {
    invoke<string>("get_setting", { key: "monthly_budget" })
      .then(setBudget)
      .catch(() => setBudget("100"));
    invoke<string>("get_setting", { key: "alert_threshold" })
      .then((v) => setThreshold(parseInt(v) || 80))
      .catch(() => setThreshold(80));
    invoke<string>("get_setting", { key: "reset_period" })
      .then(setPeriod)
      .catch(() => setPeriod("monthly"));
  }, []);

  const saveBudget = (val: string) => {
    setBudget(val);
    invoke("set_setting", { key: "monthly_budget", value: val }).catch(() => {});
  };

  const saveThreshold = (val: number) => {
    setThreshold(val);
    invoke("set_setting", { key: "alert_threshold", value: String(val) }).catch(() => {});
  };

  const savePeriod = (val: string) => {
    setPeriod(val);
    invoke("set_setting", { key: "reset_period", value: val }).catch(() => {});
  };

  return (
    <>
      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-1.5">月预算上限 (¥)</div>
        <input
          className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-3 py-2 text-[14px] font-semibold text-[#e2e8f0] outline-none focus:border-[#38bdf8] transition-colors"
          type="number"
          value={budget}
          onChange={(e) => saveBudget(e.target.value)}
        />
      </div>

      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-1.5">告警阈值</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="flex-1 accent-[#f59e0b]"
            value={threshold}
            onChange={(e) => saveThreshold(parseInt(e.target.value))}
            min={10}
            max={100}
            step={5}
          />
          <span className="text-[13px] font-semibold text-[#fbbf24] w-9 text-right">
            {threshold}%
          </span>
        </div>
        <div className="text-[9px] text-[#64748b] mt-1.5">
          用量达到 ¥{Math.round(parseInt(budget || "100") * threshold / 100)} 时弹出通知提醒
        </div>
      </div>

      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-1.5">重置周期</div>
        <div className="flex gap-1">
          <button
            onClick={() => savePeriod("daily")}
            className={`px-3 py-1.5 text-[10px] rounded-md ${
              period === "daily"
                ? "bg-[#0f172a] border border-[#38bdf8] text-[#38bdf8]"
                : "bg-[#0f172a] border border-[#334155] text-[#64748b] hover:text-[#94a3b8]"
            }`}
          >
            每日
          </button>
          <button
            onClick={() => savePeriod("monthly")}
            className={`px-3 py-1.5 text-[10px] rounded-md ${
              period === "monthly"
                ? "bg-[#0f172a] border border-[#38bdf8] text-[#38bdf8]"
                : "bg-[#0f172a] border border-[#334155] text-[#64748b] hover:text-[#94a3b8]"
            }`}
          >
            每月
          </button>
        </div>
      </div>
    </>
  );
}

function PricingTab() {
  const [pricing, setPricing] = useState<ModelPricing[]>([]);

  useEffect(() => {
    invoke<ModelPricing[]>("get_model_pricing")
      .then(setPricing)
      .catch(() => {});
  }, []);

  const updatePrice = (model: string, field: "input" | "output", val: string) => {
    const num = parseFloat(val) || 0;
    const existing = pricing.find((p) => p.model === model);
    if (existing) {
      const inputPrice = field === "input" ? num : existing.input_price_per_1m;
      const outputPrice = field === "output" ? num : existing.output_price_per_1m;
      invoke("save_model_pricing", {
        model,
        inputPrice,
        outputPrice,
      }).catch(() => {});
      setPricing((prev) =>
        prev.map((p) =>
          p.model === model
            ? { ...p, [field === "input" ? "input_price_per_1m" : "output_price_per_1m"]: num }
            : p
        )
      );
    }
  };

  return (
    <div className="space-y-2">
      {pricing.map((p) => (
        <div key={p.model} className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
          <div className="text-[11px] font-semibold mb-2">{p.model}</div>
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-[9px] text-[#64748b] mb-1">Input / M tokens</div>
              <input
                className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none focus:border-[#38bdf8]"
                type="number"
                step="0.5"
                value={p.input_price_per_1m}
                onChange={(e) => updatePrice(p.model, "input", e.target.value)}
              />
            </div>
            <div className="flex-1">
              <div className="text-[9px] text-[#64748b] mb-1">Output / M tokens</div>
              <input
                className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none focus:border-[#38bdf8]"
                type="number"
                step="0.5"
                value={p.output_price_per_1m}
                onChange={(e) => updatePrice(p.model, "output", e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="w-full text-center py-2 border border-dashed border-[#334155] rounded-lg text-[10px] text-[#64748b] hover:text-[#94a3b8] hover:border-[#64748b] transition-colors">
        + 添加模型
      </button>
    </div>
  );
}

function KeysTab({
  keys,
  showAddKey,
  setShowAddKey,
  newLabel,
  setNewLabel,
  newKey,
  setNewKey,
  newColor,
  setNewColor,
  colors,
  onAdd,
  onDelete,
}: {
  keys: ApiKey[];
  showAddKey: boolean;
  setShowAddKey: (v: boolean) => void;
  newLabel: string;
  setNewLabel: (v: string) => void;
  newKey: string;
  setNewKey: (v: string) => void;
  newColor: string;
  setNewColor: (v: string) => void;
  colors: string[];
  onAdd: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="space-y-2">
      {keys.length === 0 && (
        <div className="text-[10px] text-[#64748b] text-center py-6">
          暂无 API Key
          <br />
          代理会自动检测新 Key，或手动添加
        </div>
      )}

      <div className="bg-[#1e293b] rounded-lg border border-[#334155] divide-y divide-[#334155]">
        {keys.map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between px-3 py-2.5"
          >
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: key.color }}
                />
                <span className="text-[11px] font-semibold">{key.label}</span>
              </div>
              <div className="text-[9px] text-[#64748b] mt-0.5">
                {key.key_prefix}
              </div>
            </div>
            <button
              onClick={() => onDelete(key.id)}
              className="text-[10px] text-[#ef4444] hover:text-red-400 transition-colors"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {showAddKey && (
        <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155] space-y-2.5">
          <div className="text-[11px] font-semibold">添加 API Key</div>
          <div>
            <div className="text-[9px] text-[#64748b] mb-1">标签</div>
            <input
              className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none focus:border-[#38bdf8]"
              placeholder="如：项目A"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <div>
            <div className="text-[9px] text-[#64748b] mb-1">API Key</div>
            <input
              className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none focus:border-[#38bdf8]"
              type="password"
              placeholder="sk-..."
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
          </div>
          <div>
            <div className="text-[9px] text-[#64748b] mb-1">颜色标记</div>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className="w-5 h-5 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: newColor === c ? "white" : "transparent",
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setShowAddKey(false)}
              className="flex-1 py-1.5 text-[10px] bg-[#0f172a] border border-[#334155] rounded-md text-[#64748b] hover:text-[#94a3b8]"
            >
              取消
            </button>
            <button
              onClick={onAdd}
              className="flex-1 py-1.5 text-[10px] bg-[#38bdf8] rounded-md font-semibold text-[#0f172a] hover:bg-[#7dd3fc]"
            >
              保存
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setShowAddKey(true)}
        className="w-full text-center py-2 border border-dashed border-[#334155] rounded-lg text-[10px] text-[#64748b] hover:text-[#94a3b8] hover:border-[#64748b] transition-colors"
      >
        + 添加 API Key
      </button>
    </div>
  );
}

function ProxyTab() {
  return (
    <div className="space-y-2.5">
      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-1.5">代理端口</div>
        <input
          className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-3 py-2 text-[14px] font-semibold text-[#e2e8f0] outline-none"
          defaultValue="8800"
          type="number"
        />
        <div className="text-[9px] text-[#64748b] mt-1.5">
          代码中把 api.deepseek.com 改成 127.0.0.1:8800
        </div>
      </div>

      <div className="bg-[#1e293b] rounded-lg p-3 border border-[#334155]">
        <div className="text-[10px] text-[#94a3b8] mb-1.5">DeepSeek Endpoint</div>
        <input
          className="w-full bg-[#0f172a] border border-[#334155] rounded-md px-3 py-2 text-[13px] text-[#e2e8f0] outline-none"
          defaultValue="https://api.deepseek.com"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#1e293b] rounded-lg p-3 text-center border border-[#334155]">
          <div className="text-[9px] text-[#64748b] mb-2">开机自启</div>
          <div className="w-7 h-4 bg-green-500 rounded-full mx-auto relative">
            <div className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5" />
          </div>
        </div>
        <div className="bg-[#1e293b] rounded-lg p-3 text-center border border-[#334155]">
          <div className="text-[9px] text-[#64748b] mb-2">最小化到托盘</div>
          <div className="w-7 h-4 bg-green-500 rounded-full mx-auto relative">
            <div className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5" />
          </div>
        </div>
      </div>

      <div className="text-[9px] text-[#64748b] text-center pt-1">
        修改后重启代理生效
      </div>
    </div>
  );
}
