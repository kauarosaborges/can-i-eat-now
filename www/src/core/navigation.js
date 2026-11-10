export const ROUTE_CONFIG = [
  { id: 'today', icon: 'today', tab: true },
  { id: 'water', icon: 'water', tab: true },
  { id: 'sleep', icon: 'moon', tab: true },
  { id: 'body', icon: 'body', tab: true },
  { id: 'settings', icon: 'settings', tab: true },
  { id: 'history', icon: 'history', tab: false, parent: 'today' },
];

export function tabRoutes(config = ROUTE_CONFIG) {
  return config.filter((route) => route.tab);
}

export function routeIdFromHash(hash) {
  return String(hash || '')
    .replace(/^#\/?/, '')
    .split(/[/?]/)[0];
}

export function resolveRoute(hash, config = ROUTE_CONFIG) {
  const id = routeIdFromHash(hash);
  return config.find((route) => route.id === id) || tabRoutes(config)[0];
}

export function activeTabId(route, config = ROUTE_CONFIG) {
  if (!route) return null;
  if (route.tab) return route.id;
  const parent = config.find((item) => item.id === route.parent && item.tab);
  return parent ? parent.id : null;
}

export function tabIndexOf(route, config = ROUTE_CONFIG) {
  const id = activeTabId(route, config);
  return tabRoutes(config).findIndex((item) => item.id === id);
}

export function routeOrder(route, config = ROUTE_CONFIG) {
  return config.indexOf(route);
}
