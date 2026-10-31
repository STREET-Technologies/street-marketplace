"use client";
import { useId, type ReactNode } from "react";

export default function CustomerTabs({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { key: string; label: string; content: ReactNode }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const id = useId();
  return (
    <>
      <div className="customer-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-controls={`${id}-panel-${tab.key}`}
            aria-selected={value === tab.key}
            tabIndex={value === tab.key ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + tabs.length) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              onChange(tabs[next].key);
              document.getElementById(`${id}-tab-${tabs[next].key}`)?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          hidden={value !== tab.key}
          id={`${id}-panel-${tab.key}`}
          aria-labelledby={`${id}-tab-${tab.key}`}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </>
  );
}
