// Sidebar drawer breakpoint: at ≤1024px, sidebar becomes off-canvas drawer
// MUST sync with @media (max-width: 1024px) in admin-mod.css
export const SIDEBAR_DRAWER_MAX = 1024;

export const isDrawerViewport = () =>
  typeof window !== "undefined" && window.innerWidth <= SIDEBAR_DRAWER_MAX;

// Listen for resize and snap sidebar to correct state when crossing breakpoint
// Returns cleanup function for useEffect
export function watchDrawerBoundary(setCollapsed) {
  let wasDrawer = isDrawerViewport();
  const onResize = () => {
    const nowDrawer = isDrawerViewport();
    if (nowDrawer !== wasDrawer) {
      wasDrawer = nowDrawer;
      setCollapsed(nowDrawer);
    }
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}
