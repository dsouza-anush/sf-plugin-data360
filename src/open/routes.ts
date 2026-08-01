export const DATA360_ROUTES = {
  home: '/lightning/page/dataCloudHome',
  'data-streams': '/lightning/n/DataCloudDataStreams',
  dmo: '/lightning/n/DataCloudDataModel',
  segments: '/lightning/n/DataCloudSegments',
  activations: '/lightning/n/DataCloudActivations',
  'query-editor': '/lightning/n/DataCloudQueryEditor',
  'identity-resolutions': '/lightning/n/DataCloudIdentityResolution',
  'search-index': '/lightning/n/DataCloudSearchIndex',
} as const;

export type Data360Route = keyof typeof DATA360_ROUTES;

export const routeFor = (path: Data360Route): string => DATA360_ROUTES[path];
