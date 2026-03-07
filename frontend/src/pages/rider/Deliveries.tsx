import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type DailyEarning = {
  id: number;
  date: string;
  orders_count: number;
  per_order_cents: number;
  tip_cents: number;
  bonus_cents: number;
  total_cents: number;
  created_at?: string | null;
  updated_at?: string | null;
};

type EarningsSummary = {
  orders_count: number;
  base_pay_cents: number;
  tip_cents: number;
  bonus_cents: number;
  total_cents: number;
};

type EarningsResponse = {
  items: DailyEarning[];
  summary: EarningsSummary;
  default_rate_cents: number;
};

type EarningsCache = {
  items: DailyEarning[];
  summary: EarningsSummary;
  fromDate: string;
  toDate: string;
  syncedAt: string;
  defaultRateCents: number;
};

const CACHE_KEY = "rider_daily_earnings_cache_v1";

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

const formatMoney = (cents: number) => {
  const value = (cents || 0) / 100;
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(value);
};

const parseMoneyToCents = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100);
};

export default function Deliveries() {
  const today = new Date();
  const defaultTo = toDateInput(today);
  const defaultFrom = toDateInput(new Date(today.getTime() - 7 * 86400000));

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [items, setItems] = useState<DailyEarning[]>([]);
  const [summary, setSummary] = useState<EarningsSummary>({
    orders_count: 0,
    base_pay_cents: 0,
    tip_cents: 0,
    bonus_cents: 0,
    total_cents: 0,
  });
  const [defaultRateCents, setDefaultRateCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const [entryDate, setEntryDate] = useState(defaultTo);
  const [entryOrders, setEntryOrders] = useState("0");
  const [entryRate, setEntryRate] = useState("");
  const [entryTips, setEntryTips] = useState("");
  const [entryBonus, setEntryBonus] = useState("");

  useEffect(() => {
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (!cachedRaw) return;
    try {
      const cached = JSON.parse(cachedRaw) as EarningsCache;
      if (cached?.items) {
        setItems(cached.items);
        setSummary(cached.summary || summary);
        setLastSynced(cached.syncedAt || null);
        setDefaultRateCents(cached.defaultRateCents || 0);
        if (!entryRate && cached.defaultRateCents) {
          setEntryRate((cached.defaultRateCents / 100).toFixed(2));
        }
      }
    } catch {
      // ignore cache errors
    }
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const load = async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<EarningsResponse>("/earnings/mine", {
        params: { from: fromDate, to: toDate },
      });
      const payload = res.data;
      setItems(payload.items || []);
      setSummary(payload.summary || summary);
      setDefaultRateCents(payload.default_rate_cents || 0);
      if (!entryRate && payload.default_rate_cents) {
        setEntryRate((payload.default_rate_cents / 100).toFixed(2));
      }
      const syncedAt = new Date().toISOString();
      setLastSynced(syncedAt);
      const cache: EarningsCache = {
        items: payload.items || [],
        summary: payload.summary || summary,
        fromDate,
        toDate,
        syncedAt,
        defaultRateCents: payload.default_rate_cents || 0,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Unable to load earnings"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const lastSyncText = lastSynced ? new Date(lastSynced).toLocaleTimeString() : "Not synced yet";

  const entryOrdersCount = Number.parseInt(entryOrders || "0", 10) || 0;
  const entryRateCents = parseMoneyToCents(entryRate) ?? 0;
  const entryTipsCents = parseMoneyToCents(entryTips) ?? 0;
  const entryBonusCents = parseMoneyToCents(entryBonus) ?? 0;
  const entryBaseCents = entryOrdersCount * entryRateCents;
  const entryTotalCents = entryBaseCents + entryTipsCents + entryBonusCents;

  const avgPerOrderCents = useMemo(() => {
    if (!summary.orders_count) return 0;
    return Math.round(summary.total_cents / summary.orders_count);
  }, [summary]);

  const saveEntry = async () => {
    setErr(null);
    if (!entryDate) {
      setErr("Date is required");
      return;
    }
    if (entryOrdersCount < 0) {
      setErr("Orders must be 0 or greater");
      return;
    }
    const rateCents = parseMoneyToCents(entryRate);
    if (rateCents === null) {
      setErr("Rate must be a valid number");
      return;
    }
    const tipsCents = parseMoneyToCents(entryTips);
    if (tipsCents === null) {
      setErr("Tips must be a valid number");
      return;
    }
    const bonusCents = parseMoneyToCents(entryBonus);
    if (bonusCents === null) {
      setErr("Bonus must be a valid number");
      return;
    }
    try {
      await api.post("/earnings/mine", {
        date: entryDate,
        orders_count: entryOrdersCount,
        per_order_cents: rateCents,
        tip_cents: tipsCents,
        bonus_cents: bonusCents,
      });
      await load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Unable to save earnings"));
    }
  };

  const editEntry = (row: DailyEarning) => {
    setEntryDate(row.date);
    setEntryOrders(String(row.orders_count));
    setEntryRate((row.per_order_cents / 100).toFixed(2));
    setEntryTips((row.tip_cents / 100).toFixed(2));
    setEntryBonus((row.bonus_cents / 100).toFixed(2));
  };

  return (
    <div className="rider-stack">
      {!isOnline && <div className="rider-banner">You are offline. Showing cached earnings.</div>}

      <section className="rider-card rider-fade">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Daily earnings</div>
            <div className="rider-card-subtitle">Enter your orders each day to track your payout.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">Last sync {lastSyncText}</span>
          </div>
        </div>

        <div className="rider-filter-bar">
          <div>
            <div className="rider-card-subtitle">From</div>
            <input className="rider-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <div className="rider-card-subtitle">To</div>
            <input className="rider-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="rider-filter-actions">
            <button type="button" className="rider-btn rider-btn-ghost" onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {err && <div className="rider-alert" style={{ marginTop: 12 }}>{err}</div>}
      </section>

      <section className="rider-card rider-fade rider-stagger-1">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Add or update day</div>
            <div className="rider-card-subtitle">
              {defaultRateCents
                ? `Default rate ${formatMoney(defaultRateCents)} per order`
                : "Set your rate per order to calculate totals."}
            </div>
          </div>
        </div>

        <div className="rider-filter-bar">
          <div>
            <div className="rider-card-subtitle">Date</div>
            <input className="rider-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div>
            <div className="rider-card-subtitle">Orders</div>
            <input
              className="rider-input"
              type="number"
              min="0"
              value={entryOrders}
              onChange={(e) => setEntryOrders(e.target.value)}
            />
          </div>
          <div>
            <div className="rider-card-subtitle">Rate per order</div>
            <input
              className="rider-input"
              type="number"
              step="0.01"
              min="0"
              value={entryRate}
              onChange={(e) => setEntryRate(e.target.value)}
              placeholder={defaultRateCents ? (defaultRateCents / 100).toFixed(2) : "0.00"}
            />
          </div>
          <div>
            <div className="rider-card-subtitle">Tips</div>
            <input
              className="rider-input"
              type="number"
              step="0.01"
              min="0"
              value={entryTips}
              onChange={(e) => setEntryTips(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <div className="rider-card-subtitle">Bonus</div>
            <input
              className="rider-input"
              type="number"
              step="0.01"
              min="0"
              value={entryBonus}
              onChange={(e) => setEntryBonus(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="rider-filter-actions" style={{ alignSelf: "end" }}>
            <button type="button" className="rider-btn rider-btn-primary" onClick={saveEntry} disabled={loading}>
              Save day
            </button>
          </div>
        </div>

        <div className="rider-kpi-grid" style={{ marginTop: 12 }}>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{entryOrdersCount}</div>
            <div className="rider-kpi-label">Orders</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(entryBaseCents)}</div>
            <div className="rider-kpi-label">Base pay</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(entryTipsCents)}</div>
            <div className="rider-kpi-label">Tips</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(entryBonusCents)}</div>
            <div className="rider-kpi-label">Bonus</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(entryTotalCents)}</div>
            <div className="rider-kpi-label">Total for day</div>
          </div>
        </div>
      </section>

      <section className="rider-card rider-fade rider-stagger-2">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Summary</div>
            <div className="rider-card-subtitle">Totals for this range.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">{summary.orders_count} orders</span>
          </div>
        </div>
        <div className="rider-kpi-grid">
          <div className="rider-kpi">
            <div className="rider-kpi-value">{summary.orders_count}</div>
            <div className="rider-kpi-label">Orders</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(summary.total_cents)}</div>
            <div className="rider-kpi-label">Total earned</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(summary.tip_cents)}</div>
            <div className="rider-kpi-label">Tips</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(summary.bonus_cents)}</div>
            <div className="rider-kpi-label">Bonuses</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(avgPerOrderCents)}</div>
            <div className="rider-kpi-label">Avg per order</div>
          </div>
          <div className="rider-kpi">
            <div className="rider-kpi-value">{formatMoney(summary.base_pay_cents)}</div>
            <div className="rider-kpi-label">Base pay</div>
          </div>
        </div>
      </section>

      <section className="rider-card rider-fade rider-stagger-3">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">History</div>
            <div className="rider-card-subtitle">Your daily records.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">{items.length} days</span>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="rider-empty" style={{ marginTop: 12 }}>No earnings recorded yet.</div>
        ) : (
          <div className="rider-list" style={{ marginTop: 12 }}>
            {items.map((d) => (
              <div key={d.id} className="rider-list-item" style={{ alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{d.date}</div>
                  <div className="rider-card-subtitle">
                    {d.orders_count} orders - Rate {formatMoney(d.per_order_cents)}
                  </div>
                  <div className="rider-card-subtitle">
                    Base {formatMoney(d.orders_count * d.per_order_cents)} - Tips {formatMoney(d.tip_cents)} - Bonus {formatMoney(d.bonus_cents)}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6, textAlign: "right" }}>
                  <div className="rider-pill">{formatMoney(d.total_cents)}</div>
                  <button type="button" className="rider-btn rider-btn-ghost" onClick={() => editEntry(d)}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
