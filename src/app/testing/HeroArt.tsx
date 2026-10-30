"use client";

import { useRef, useState } from "react";
import styles from "./desert.module.css";

const ART = [
  {
    id: "sunset-dance-floor",
    label: "Sunset dance floor",
    src: "/images/testing/sunset-dance-floor.webp",
    alt: "Illustrated guests line dancing under string lights with desert mesas and a setting sun behind them"
  },
  {
    id: "boot-line",
    label: "Boot line",
    src: "/images/testing/hero-boot-line.svg",
    alt: "A row of colorful cowboy boots stepping in unison in front of a desert sunburst"
  },
  {
    id: "dance-hall",
    label: "Dance hall",
    src: "/images/testing/hero-dance-hall.svg",
    alt: "A desert dance hall glowing at night under string lights and stars"
  }
];

export function HeroArt() {
  const [active, setActive] = useState(0);
  const selection = useRef(0);
  const art = ART[active];

  async function selectArt(index: number) {
    const request = ++selection.current;
    if (index === active) return;

    const image = new Image();
    image.src = ART[index].src;
    try {
      await image.decode();
      if (request === selection.current) setActive(index);
    } catch {
      // Keep the current illustration visible if the next image cannot load.
    }
  }

  return (
    <div className={styles.heroArt}>
      <div className={styles.arch}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.src} alt={art.alt} fetchPriority="high" />
      </div>
      <div className={styles.artSwitch} role="group" aria-label="Preview hero art">
        {ART.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={index === active}
            className={index === active ? styles.artOn : undefined}
            onClick={() => { void selectArt(index); }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
