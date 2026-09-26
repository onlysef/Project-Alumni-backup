import { useEffect } from "react";

// The body/.app/.content chain sizes itself off 100dvh so a mobile on-screen
// keyboard shrinks it instead of trapping content (like the AI Assistant's
// composer) behind the keyboard. Meta's in-app browser (Messenger/Facebook)
// — and other older Android WebViews — run a Chromium build that supports
// the visualViewport API but not the `dvh` unit, so `dvh` there just reports
// the full screen height and never shrinks when the keyboard opens. Mirroring
// the actual visible height into a `--app-vh` CSS var via visualViewport
// works in that WebView too, and CSS declares it last so it overrides `dvh`
// wherever both are present, falling back to `dvh` before this effect's
// first run or if visualViewport is unavailable.
export function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    function setVh() {
      const height = vv?.height || window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${height}px`);
    }
    setVh();
    vv?.addEventListener("resize", setVh);
    vv?.addEventListener("scroll", setVh);
    window.addEventListener("resize", setVh);
    return () => {
      vv?.removeEventListener("resize", setVh);
      vv?.removeEventListener("scroll", setVh);
      window.removeEventListener("resize", setVh);
    };
  }, []);
}
