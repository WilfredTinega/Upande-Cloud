"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAppUrl = buildAppUrl;
exports.appSubdomainHost = appSubdomainHost;
exports.buildSubdomainRouterLabels = buildSubdomainRouterLabels;
function buildAppUrl(subdomain) {
    const domain = process.env.BASE_DOMAIN ?? 'localhost';
    const scheme = process.env.APP_HTTP_SCHEME ?? 'http';
    const port = process.env.APP_HTTP_PORT ?? '80';
    const suffix = port && port !== '80' && port !== '443' ? `:${port}` : '';
    return `${scheme}://${subdomain}.${domain}${suffix}`;
}
function appSubdomainHost(subdomain) {
    const domain = process.env.BASE_DOMAIN ?? 'localhost';
    return `${subdomain}.${domain}`;
}
function buildSubdomainRouterLabels(subdomain, containerPort) {
    const resolver = process.env.ACME_RESOLVER;
    const labels = {
        'traefik.enable': 'true',
        [`traefik.http.routers.${subdomain}.rule`]: `Host(\`${appSubdomainHost(subdomain)}\`)`,
        [`traefik.http.services.${subdomain}.loadbalancer.server.port`]: String(containerPort),
    };
    if (resolver) {
        labels[`traefik.http.routers.${subdomain}.entrypoints`] = 'websecure';
        labels[`traefik.http.routers.${subdomain}.tls`] = 'true';
        labels[`traefik.http.routers.${subdomain}.tls.certresolver`] = resolver;
    }
    return labels;
}
//# sourceMappingURL=app-url.util.js.map