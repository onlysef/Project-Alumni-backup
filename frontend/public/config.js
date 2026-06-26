(function () {
  var IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  window.APP_CONFIG = {
    API: IS_LOCAL ? 'http://localhost:5000/api' : 'https://project-alumni-eight.vercel.app/api',
    APP: IS_LOCAL ? 'http://localhost:5173' : 'https://project-alumni-rrxj.vercel.app',
  };
})();
