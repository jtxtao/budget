import { Children, createContext, isValidElement, useContext, useMemo } from "react";
import useSyncedState from "../hooks/useSyncedState";

// Chart height tiers, in SVG viewBox units (same scale as VIEW.width = 760).
export const CHART_HEIGHTS = { sm: 180, md: 270, lg: 390 };

const DEFAULT_WIDGETS = [
  { id: "summary", label: "Summary", visible: true, width: "full" },
  { id: "calendar", label: "Cashflow calendar & runway", visible: true, width: "full" },
  { id: "scheduled", label: "Scheduled and other spending", visible: true, width: "half" },
  { id: "month", label: "Month by month", visible: true, width: "full", height: "md" },
  { id: "heatmap", label: "Spending by day", visible: true, width: "full" },
  { id: "savings-rate", label: "Savings rate trend", visible: true, width: "half", height: "sm" },
  { id: "income", label: "Income by source", visible: true, width: "half" },
  { id: "flows", label: "Where it came from, where it went", visible: true, width: "full" },
  { id: "plan", label: "Against the plan", visible: true, width: "full", height: "md" },
  { id: "categories", label: "Where the money went", visible: true, width: "full" },
];

// Which widget ids contain a chart that accepts a chartHeight prop.
const CHART_WIDGET_IDS = new Set(["month", "savings-rate", "plan"]);

function migrateWidgets(value) {
  if (!Array.isArray(value)) return DEFAULT_WIDGETS;
  const saved = new Map(value.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  return [...value.filter((item) => DEFAULT_WIDGETS.some((known) => known.id === item?.id)),
    ...DEFAULT_WIDGETS.filter((item) => !saved.has(item.id))]
    .map((item) => ({ ...DEFAULT_WIDGETS.find((known) => known.id === item.id), ...saved.get(item.id) }));
}

// Provides a Map<widgetId, config> to descendants inside ReportWidgetLayout.
export const WidgetConfigContext = createContext(new Map());

// Read inside a descendant of ReportWidgetLayout's provider.
export function useWidgetConfig(id) {
  return useContext(WidgetConfigContext).get(id) ?? {};
}

function HeightButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-label uppercase transition-colors ${
        active
          ? "border-chalk bg-panel-raised text-chalk"
          : "border-edge text-chalk-soft hover:border-chalk hover:text-chalk"
      }`}
    >
      {children}
    </button>
  );
}

export default function ReportWidgetLayout({ children }) {
  const [widgets] = useSyncedState("reportWidgets", DEFAULT_WIDGETS, migrateWidgets);
  const content = useMemo(() => {
    const byId = new Map();
    const other = [];
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.props["data-widget-id"]) byId.set(child.props["data-widget-id"], child);
      else other.push(child);
    });
    return { byId, other };
  }, [children]);
  const ordered = widgets.filter((widget) => content.byId.has(widget.id));
  const configMap = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);

  return (
    <WidgetConfigContext.Provider value={configMap}>
      {content.other}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ordered.filter((widget) => widget.visible).map((widget) => (
          <div key={widget.id} className={widget.width === "half" ? "" : "md:col-span-2"}>
            {content.byId.get(widget.id)}
          </div>
        ))}
      </div>
    </WidgetConfigContext.Provider>
  );
}

export function ReportWidgetSettings() {
  const [widgets, setWidgets] = useSyncedState("reportWidgets", DEFAULT_WIDGETS, migrateWidgets);
  const ordered = widgets;

  function update(id, change) {
    setWidgets((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  function move(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= ordered.length) return;
    setWidgets((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <section className="rounded-2xl border border-edge bg-panel px-4 py-3">
      <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Report widgets</h2>
      <p className="mt-1 font-sans text-row text-chalk-soft">Choose what appears in reports and adjust its layout.</p>
      <div className="mt-3 space-y-2">
        {ordered.map((widget, index) => (
          <div key={widget.id} className="flex flex-wrap items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 font-sans text-row text-chalk">
              <input type="checkbox" checked={widget.visible} onChange={() => update(widget.id, { visible: !widget.visible })} />
              <span className="truncate">{widget.label}</span>
            </label>
            {CHART_WIDGET_IDS.has(widget.id) && (
              <div className="flex shrink-0 items-center gap-1" aria-label={`${widget.label} chart height`}>
                {["sm", "md", "lg"].map((tier) => (
                  <HeightButton key={tier} active={(widget.height ?? "md") === tier} onClick={() => update(widget.id, { height: tier })}>
                    {tier === "sm" ? "S" : tier === "md" ? "M" : "L"}
                  </HeightButton>
                ))}
              </div>
            )}
            <button type="button" title={widget.width === "half" ? "Switch to full width" : "Switch to half width"} onClick={() => update(widget.id, { width: widget.width === "half" ? "full" : "half" })} className="shrink-0 rounded border border-edge px-2 py-0.5 text-label uppercase text-chalk-soft hover:border-chalk hover:text-chalk">
              {widget.width === "half" ? "½" : "↔"}
            </button>
            <div className="flex gap-1">
              <button type="button" aria-label={`Move ${widget.label} up`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded border border-edge px-2 py-0.5 text-label text-chalk-soft disabled:opacity-40">↑</button>
              <button type="button" aria-label={`Move ${widget.label} down`} disabled={index === ordered.length - 1} onClick={() => move(index, 1)} className="rounded border border-edge px-2 py-0.5 text-label text-chalk-soft disabled:opacity-40">↓</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
