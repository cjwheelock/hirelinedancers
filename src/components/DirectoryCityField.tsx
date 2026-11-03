"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { serviceMarkets } from "@/data/site";
import styles from "./DirectoryCityField.module.css";

export function DirectoryCityField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const query = value.trim().toLowerCase().replace(/\s+/g, " ");
  const suggestions = serviceMarkets.filter((market) => `${market.city}, ${market.state}`.toLowerCase().includes(query));
  const expanded = open && suggestions.length > 0;
  const activeSuggestion = expanded ? suggestions[activeIndex] : undefined;
  const optionId = (slug: string) => `directory-city-${slug}`;

  useEffect(() => {
    if (expanded && activeIndex >= 0) {
      listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, expanded]);

  function selectCity(index: number) {
    const market = suggestions[index];
    if (!market) return;
    onChange(`${market.city}, ${market.state}`);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }}>
      <label htmlFor="directory-city-input">
        <span><MapPin size={16} aria-hidden="true" /> City</span>
      </label>
      <div className={styles.control}>
        <input
          id="directory-city-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? "directory-city-suggestions" : undefined}
          aria-activedescendant={activeSuggestion ? optionId(activeSuggestion.slug) : undefined}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (!suggestions.length) return;
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => {
                if (!expanded || index < 0) return event.key === "ArrowDown" ? 0 : suggestions.length - 1;
                return (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
              });
            } else if (event.key === "Enter" && activeSuggestion) {
              event.preventDefault();
              selectCity(activeIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setActiveIndex(-1);
            } else if (event.key === "Tab") {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
          placeholder="Any US city, for example Tulsa, OK"
          autoComplete="off"
        />
        {expanded ? (
          <ul
            ref={listRef}
            id="directory-city-suggestions"
            role="listbox"
            aria-label="City"
            className={styles.suggestions}
            // Keep input focus through a click without preventing touch scrolling.
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestions.map((market, index) => (
              <li
                key={market.slug}
                id={optionId(market.slug)}
                role="option"
                aria-selected={activeIndex === index}
                className={styles.option}
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse") setActiveIndex(index);
                }}
                onClick={() => selectCity(index)}
              >
                <MapPin size={17} aria-hidden="true" />
                <span>{market.city}, {market.state}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
