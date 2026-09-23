(function () {
  var host = window.location.hostname;
  var IS_LOCAL = ['localhost', '127.0.0.1'].includes(host);

  // Accessed through a forwarded VS Code dev tunnel — route API calls back
  // through this SAME tunneled origin instead of a second tunnel for the
  // backend port. A separate 5000 tunnel is a genuinely different origin
  // from the browser's point of view, and devtunnels.ms's anti-abuse
  // click-through cookie for one tunnel origin isn't sent on background
  // fetch() calls to a different tunnel origin — visiting the backend URL
  // directly "worked" but the app's own fetch calls still failed. Routing
  // through the same origin sidesteps that entirely: vite.config.js proxies
  // "/api" to localhost:5000 itself (server-to-server), so only ONE port
  // (5173) ever needs to be forwarded/public.
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
