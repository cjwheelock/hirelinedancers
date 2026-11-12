"use client";
import Script from "next/script";
function processEmbeds() {
  const instagram = (window as Window & { instgrm?: { Embeds: { process: () => void } } }).instgrm;
  instagram?.Embeds.process();
}
export function InstagramEmbedLoader() {
  return <Script src="https://www.instagram.com/embed.js" strategy="afterInteractive" onReady={processEmbeds} />;
}
