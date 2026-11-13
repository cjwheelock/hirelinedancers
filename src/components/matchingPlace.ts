import { parseCityQuery, stateNames } from "./SearchPanel";

export type MatchingPlace = { city: string; region: string; short: string; full: string };

function titleCase(value: string) {
  return value.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

// Turns a typed search ("boise, id", "Tulsa Oklahoma", "Idaho") into display labels.
export function placeFromQuery(query: string): MatchingPlace | null {
  const { city, region } = parseCityQuery(query);
  const regionName = Object.entries(stateNames).find(([, code]) => code === region)?.[0];
  const cityLabel = city ? titleCase(city) : "";
  const regionLabel = /^[A-Z]{2}$/.test(region) ? region : "";
  if (cityLabel) {
    return { city: cityLabel, region: regionLabel, short: cityLabel, full: regionLabel ? `${cityLabel}, ${regionLabel}` : cityLabel };
  }
  if (regionName) {
    const label = titleCase(regionName);
    return { city: "", region: regionLabel, short: label, full: label };
  }
  return null;
}

export function matchingRequestHref(query: string, eventSlug?: string) {
  const params = new URLSearchParams({ city: query.trim() });
  if (eventSlug) params.set("event", eventSlug);
  return `/find-an-instructor/?${params.toString()}`;
}
