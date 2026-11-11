export type PublicProfilePackage = { name: string; description?: string; durationHours?: number };
export function publicProfilePackages(packages: unknown): PublicProfilePackage[];
