"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { revealBrowseContent } from "../lib/browse-navigation";

export default function CustomerTabs({
  label,
  tabs,
  value,
  onChange,
  sidebar = false,
}: {
  sidebar?: boolean;
  label: string;
  tabs: { key: string; label: string; content: ReactNode }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const id = useId();
  const layout = useRef<HTMLDivElement>(null);
  const [selectionRequest, setSelectionRequest] = useState(0);
  const select = (key: string) => {
    onChange(key);
    setSelectionRequest((request) => request + 1);
  };
  useLayoutEffect(() => {
    if (!sidebar || !selectionRequest) return;
    revealBrowseContent(layout.current?.querySelector('[role="tabpanel"]:not([hidden])'));
  }, [value, selectionRequest, sidebar]);
  const [vertical, setVertical] = useState(false);
  useEffect(() => {
    if (!sidebar) return;
    const media = window.matchMedia("(min-width: 1100px)");
    const update = () => setVertical(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [sidebar]);
  return (
    <div ref={layout} className={sidebar ? "browse-layout customer-tab-layout" : undefined}>
      <div className="customer-tabs" role="tablist" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"}>
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-controls={`${id}-panel-${tab.key}`}
            aria-selected={value === tab.key}
            tabIndex={value === tab.key ? 0 : -1}
            onClick={() => select(tab.key)}
            onKeyDown={(event) => {
              const next =
                event.key === (vertical ? "ArrowDown" : "ArrowRight")
                  ? (index + 1) % tabs.length
                  : event.key === (vertical ? "ArrowUp" : "ArrowLeft")
                    ? (index - 1 + tabs.length) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              select(tabs[next].key);
              document.getElementById(`${id}-tab-${tabs[next].key}`)?.focus({ preventScroll: true });
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
    </div>
  );
}
