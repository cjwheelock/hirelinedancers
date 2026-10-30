"use client";

import { useState } from "react";
import styles from "./desert.module.css";

const ART = [
  {
    id: "golden-hour",
    label: "Golden hour",
    src: "/images/testing/hero-golden-hour.svg",
    alt: "Desert mesas at sunset with string lights over a wooden dance floor and a row of cowboy boots mid-step"
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
  const art = ART[active];

  return (
    <div className={styles.heroArt}>
      <div className={styles.arch}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.src} alt={art.alt} />
      </div>
      <div className={styles.artSwitch} role="group" aria-label="Preview hero art">
        {ART.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={index === active}
            className={index === active ? styles.artOn : undefined}
            onClick={() => setActive(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
