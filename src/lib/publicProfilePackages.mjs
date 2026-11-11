// Public package data is an allowlist: never serialize stored pricing or future private fields.
export function publicProfilePackages(packages) {
  if (!Array.isArray(packages)) return [];
  return packages.filter(item => item && typeof item.name === 'string').map(item => ({
    name: item.name,
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    ...(typeof item.durationHours === 'number' ? { durationHours: item.durationHours } : {})
  }));
}
