(function () {
  var host = window.location.hostname;
  var IS_LOCAL = ['localhost', '127.0.0.1'].includes(host);

  // Dev tunnel: send API calls through this same origin (Vite proxies /api), since fetches to a second tunnel origin fail.
  var isDevTunnel = !IS_LOCAL && host.endsWith('.devtunnels.ms');

  window.APP_CONFIG = {
    API: IS_LOCAL
      ? 'http://localhost:5000/api'
      : isDevTunnel
        ? window.location.origin + '/api'
        : 'https://alumni-backend-production-a303.up.railway.app/api',
    APP: IS_LOCAL
      ? 'http://localhost:5173'
      : isDevTunnel
        ? window.location.origin
        : 'https://alumni-frontend-production.up.railway.app',
  };
})();
