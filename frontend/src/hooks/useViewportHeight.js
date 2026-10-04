import { useEffect } from "react";

// Mirrors the visible viewport height into --app-vh for WebViews (e.g. Messenger) whose dvh ignores the keyboard.
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
