const adminSvgIconBasePath = "../assets/icons/admin";

function getAdminSvgIconUrl(name) {
    return `${adminSvgIconBasePath}/${name}.svg`;
}

const adminSvgCache = new Map();

async function fetchSvgMarkup(name) {
    if (adminSvgCache.has(name)) {
        return adminSvgCache.get(name);
    }
    const promise = fetch(getAdminSvgIconUrl(name))
        .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
        .then((text) => text.replace(/^\uFEFF/, "").trim());
    adminSvgCache.set(name, promise);
    return promise;
}

async function hydrateOne(placeholder) {
    const iconName = placeholder.dataset.svgIcon;
    if (!iconName) {
        return;
    }
    placeholder.removeAttribute("data-svg-icon");
    try {
        const markup = await fetchSvgMarkup(iconName);
        const wrapper = document.createElement("span");
        wrapper.innerHTML = markup;
        const svg = wrapper.querySelector("svg");
        if (!svg) {
            return;
        }
        svg.classList.add("admin-svg-icon");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        placeholder.replaceWith(svg);
    } catch (err) {
        console.warn(`admin-svg-icon: failed to load "${iconName}"`, err);
    }
}

function hydrateAdminSvgIcons(root = document) {
    root.querySelectorAll("[data-svg-icon]").forEach(hydrateOne);
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
                hydrateOne(node);
                return;
            }
            hydrateAdminSvgIcons(node);
        });
    });
});

adminSvgObserver.observe(document.body, { childList: true, subtree: true });