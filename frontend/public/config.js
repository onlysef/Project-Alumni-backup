(function () {
  var host = window.location.hostname;
  var IS_LOCAL = ['localhost', '127.0.0.1'].includes(host);

  // VS Code's built-in port forwarding (dev tunnels) exposes each forwarded
  // port under the SAME random tunnel id/region, with only the port number
  // itself differing in the hostname (e.g. "abc123-5173.usw2.devtunnels.ms"
  // for the frontend, "abc123-5000.usw2.devtunnels.ms" for the backend) —
  // swapping "-5173." for "-5000." derives the tunneled backend URL without
  // hardcoding a tunnel URL that changes every time VS Code opens a new one.
  var isDevTunnel = !IS_LOCAL && host.indexOf('-5173.') !== -1 && host.endsWith('.devtunnels.ms');
  var tunnelApiHost = isDevTunnel ? host.replace('-5173.', '-5000.') : null;

  window.APP_CONFIG = {
    API: IS_LOCAL
      ? 'http://localhost:5000/api'
      : tunnelApiHost
        ? 'https://' + tunnelApiHost + '/api'
        : 'https://project-alumni-backend.vercel.app/api',
    APP: IS_LOCAL
      ? 'http://localhost:5173'
      : isDevTunnel
        ? window.location.origin
        : 'https://project-alumni-frontend.vercel.app',
  };
})();
