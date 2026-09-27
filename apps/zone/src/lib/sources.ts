/**
 * Known image sources. Each publishes the platform images (api/dashboard/admin)
 * at `<registry>/<app>` and the mirrored base images at `<registry>/mirror/*`.
 */
export interface ImageSource {
  id: string;
  label: string;
  registry: string;
}

export const IMAGE_SOURCES: ImageSource[] = [
  { id: 'upande', label: 'Upande Cloud', registry: 'ghcr.io/wilfredtinega/upande-cloud' },
  { id: 'zonal', label: 'Zonal Cloud', registry: 'ghcr.io/zonaltech/zonal-cloud' },
];

export const DEFAULT_SOURCE = IMAGE_SOURCES[0];

export const mirrorOf = (registry: string): string => `${registry}/mirror`;

export const sourceById = (id: string): ImageSource | undefined =>
  IMAGE_SOURCES.find((s) => s.id === id.toLowerCase());

export const sourceByRegistry = (registry?: string): ImageSource | undefined =>
  registry ? IMAGE_SOURCES.find((s) => s.registry === registry) : undefined;
