const adminSvgIconBasePath = "../assets/icons/admin";

function getAdminSvgIconUrl(name) {
    return `${adminSvgIconBasePath}/${name}.svg`;
}

function hydrateAdminSvgIcons(root = document) {
    root.querySelectorAll("[data-svg-icon]").forEach((placeholder) => {
        const iconName = placeholder.dataset.svgIcon;

        if (!iconName) {
            return;
        }

        const icon = document.createElement("span");
        icon.className = "admin-svg-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.style.setProperty("--icon-url", `url("${getAdminSvgIconUrl(iconName)}")`);

        placeholder.replaceWith(icon);
    });
}

window.AdminSvgIcons = {
    get: getAdminSvgIconUrl,
    hydrate: hydrateAdminSvgIcons
};

hydrateAdminSvgIcons();

const adminSvgObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }

            if (node.matches("[data-svg-icon]")) {
                hydrateAdminSvgIcons(node.parentElement || document);
                return;
            }

            hydrateAdminSvgIcons(node);
        });
    });
});

adminSvgObserver.observe(document.body, { childList: true, subtree: true });
