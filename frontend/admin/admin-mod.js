const toast = document.querySelector(".toast");
const assistantBody = document.querySelector(".assistant-body");
const assistantInput = document.querySelector("#assistantInput");
const sendButton = document.querySelector(".send");
const chips = document.querySelectorAll(".chips button");
const pageTitle = document.querySelector(".topbar h2");
const app = document.querySelector(".app");
const sidebarToggle = document.querySelector('[data-action="sidebar-toggle"]');
const assistantPanel = assistantBody.closest(".panel");
const assistantMenuButton = document.querySelector('[data-action="assistant-menu"]');

const careerSets = [
    {
        label: "All",
        values: [50, 45, 35],
        legends: ["BSIT - 50%", "BSCS - 45%", "BSIS - 35%"]
    },
    {
        label: "This Month",
        values: [58, 49, 41],
        legends: ["BSIT - 58%", "BSCS - 49%", "BSIS - 41%"]
    },
    {
        label: "This Year",
        values: [62, 54, 44],
        legends: ["BSIT - 62%", "BSCS - 54%", "BSIS - 44%"]
    }
];

const employmentSets = [
    { label: "All", employed: 65, unemployed: 20, unidentified: 15, count: 260 },
    { label: "Recent", employed: 72, unemployed: 18, unidentified: 10, count: 288 },
    { label: "Verified", employed: 80, unemployed: 12, unidentified: 8, count: 320 }
];

let careerIndex = 0;
let employmentIndex = 0;
let toastTimer;

const assistantGreetings = [
    "Hello! I'm AC, your AI chatbot. How may I assist you today?\nYou may ask about alumni records, tracer surveys, or job opportunities.",
    "Hi, I'm AC. I can help you review alumni records, employment status, tracer surveys, and recent activities.",
    "Welcome back. I'm AC, your AI assistant for alumni records, reports, appointments, and employment insights.",
    "Good day! I'm AC. Ask me about alumni profiles, course alignment, survey completion, or job opportunities."
];

function addTooltip(element, getText, color = "#570013") {
    element.addEventListener("mouseenter", (event) => {
        const tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.textContent = typeof getText === "function" ? getText(element) : getText;
        tooltip.style.background = color;
        document.body.appendChild(tooltip);
        moveTooltip(event, tooltip);
    });

    element.addEventListener("mousemove", (event) => {
        const tooltip = document.querySelector(".chart-tooltip");
        if (tooltip) {
            moveTooltip(event, tooltip);
        }
    });

    element.addEventListener("mouseleave", () => {
        document.querySelector(".chart-tooltip")?.remove();
    });
}

function moveTooltip(event, tooltip) {
    const offset = 14;
    tooltip.style.left = `${event.clientX + offset}px`;
    tooltip.style.top = `${event.clientY + offset}px`;
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function currentTime() {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

function initializeAssistantGreeting() {
    const firstBubble = assistantBody.querySelector(".chat-row .bubble");
    const firstTime = assistantBody.querySelector(".chat-row .chat-time");
    const greeting = assistantGreetings[Math.floor(Math.random() * assistantGreetings.length)];

    if (firstBubble) {
        firstBubble.textContent = greeting;
    }

    if (firstTime) {
        firstTime.textContent = currentTime();
    }
}

function createMessage(text, type = "bot") {
    const row = document.createElement("div");
    row.className = type === "user" ? "chat-row user" : "chat-row";

    if (type === "bot") {
        const bot = document.createElement("div");
        bot.className = "bot";
        bot.textContent = "AC";
        row.appendChild(bot);
    }

    const wrap = document.createElement("div");
    const bubble = document.createElement("div");
    const time = document.createElement("div");

    bubble.className = "bubble";
    bubble.textContent = text;
    time.className = "chat-time";
    time.textContent = currentTime();

    wrap.append(bubble, time);
    row.appendChild(wrap);

    const chipsBlock = document.querySelector(".chips");
    assistantBody.insertBefore(row, chipsBlock);
}

initializeAssistantGreeting();

function assistantReply(message) {
    const normalized = message.toLowerCase();

    if (normalized.includes("record")) {
        return "There are 400 alumni records in the dashboard. You can filter them by course, employment status, or tracer submission date.";
    }

    if (normalized.includes("survey") || normalized.includes("tracer")) {
        return "There are 100 recent tracer submissions. The latest activity list shows the newest alumni engagement updates.";
    }

    if (normalized.includes("employment") || normalized.includes("employed")) {
        return "260 alumni are currently marked as employed, with the distribution chart showing employed, unemployed, and unidentified records.";
    }

    if (normalized.includes("job") || normalized.includes("opportunit")) {
        return "You can review job fair posts, internships, and career webinar activity from the recent post panel.";
    }

    return "I can help with alumni records, tracer surveys, employment status, and job opportunities. Try one of the quick buttons below.";
}

function sendMessage(message = assistantInput.value.trim()) {
    if (!message) {
        showToast("Type a message first.");
        assistantInput.focus();
        return;
    }

    createMessage(message, "user");
    assistantInput.value = "";
    assistantBody.classList.add("is-thinking");

    setTimeout(() => {
        createMessage(assistantReply(message), "bot");
        assistantBody.classList.remove("is-thinking");
    }, 450);
}

function updateCareerChart(index = (careerIndex + 1) % careerSets.length) {
    careerIndex = index;
    const data = careerSets[careerIndex];
    const bars = document.querySelectorAll(".bar-layout .bar");
    const legends = document.querySelectorAll(".bar-layout .legend-row span:last-child");
    const insights = document.querySelectorAll(".bar-layout .chart-insights span");

    data.values.forEach((value, index) => {
        bars[index].style.height = `${Math.max(value * 2.2, 24)}px`;
        bars[index].textContent = `${value}%`;
        legends[index].textContent = data.legends[index];
    });

    const topIndex = data.values.indexOf(Math.max(...data.values));
    const average = Math.round(data.values.reduce((total, value) => total + value, 0) / data.values.length);
    insights[0].textContent = ["BSIT", "BSCS", "BSIS"][topIndex];
    insights[1].textContent = `${average}%`;
    insights[2].textContent = "TSM, NA, WMA";
    insights[3].textContent = `${["BSIT", "BSCS", "BSIS"][data.values.indexOf(Math.min(...data.values))]} alignment`;

    showToast(`Course chart filtered: ${data.label}`);
}

function updateEmploymentChart(index = (employmentIndex + 1) % employmentSets.length) {
    employmentIndex = index;
    const data = employmentSets[employmentIndex];
    const donut = document.querySelector(".donut");
    const legends = document.querySelectorAll(".donut-layout .legend-row span:last-child");
    const insights = document.querySelectorAll(".donut-layout .chart-insights span");
    const employedEnd = data.employed;
    const unemployedEnd = data.employed + data.unemployed;

    donut.dataset.count = data.count;
    donut.style.background = `conic-gradient(#941527 0 ${employedEnd}%, #d7d7d7 ${employedEnd}% ${unemployedEnd}%, #e9ad69 ${unemployedEnd}% 100%)`;
    legends[0].textContent = `Employed - ${data.employed}%`;
    legends[1].textContent = `Unemployed - ${data.unemployed}%`;
    legends[2].textContent = `Unidentified - ${data.unidentified}%`;
    insights[0].textContent = `${Math.round(data.count / (data.employed / 100))} alumni`;
    insights[1].textContent = `${Math.round(data.count * (data.unidentified / data.employed))} records`;
    insights[2].textContent = data.employed >= 75 ? "+12% employed" : "+8% employed";

    showToast(`Employment chart filtered: ${data.label}`);
}

function closeFilterMenus() {
    document.querySelectorAll(".filter-menu.show").forEach((menu) => menu.classList.remove("show"));
    document.querySelectorAll(".report-filter-menu.show").forEach((menu) => menu.classList.remove("show"));
    document.querySelectorAll(".table-filter-menu.show").forEach((menu) => menu.classList.remove("show"));
}

function closeAssistantMenu() {
    document.querySelector(".assistant-menu.show")?.classList.remove("show");
    assistantMenuButton.setAttribute("aria-expanded", "false");
}

function createChartFilterMenu(button, dataSets, onSelect) {
    const menu = document.createElement("div");
    menu.className = "filter-menu";

    dataSets.forEach((data, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = data.label;
        option.addEventListener("click", (event) => {
            event.stopPropagation();
            menu.querySelector(".active")?.classList.remove("active");
            option.classList.add("active");
            button.textContent = data.label;
            menu.classList.remove("show");
            onSelect(index);
        });

        if (index === 0) {
            option.classList.add("active");
        }

        menu.appendChild(option);
    });

    button.insertAdjacentElement("afterend", menu);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = menu.classList.contains("show");
        closeFilterMenus();
        menu.classList.toggle("show", !isOpen);
    });
}

function createReportFilterMenu(button, options) {
    const menu = document.createElement("div");
    const reportName = button.closest(".report-row").querySelector("span").textContent;
    menu.className = "report-filter-menu";

    options.forEach((label, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = label;
        option.addEventListener("click", (event) => {
            event.stopPropagation();
            menu.querySelector(".active")?.classList.remove("active");
            option.classList.add("active");
            button.textContent = label;
            menu.classList.remove("show");
            showToast(`${reportName}: ${label}`);
        });

        if (index === 0) {
            option.classList.add("active");
        }

        menu.appendChild(option);
    });

    button.insertAdjacentElement("afterend", menu);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = menu.classList.contains("show");
        closeFilterMenus();
        closeAssistantMenu();
        menu.classList.toggle("show", !isOpen);
    });
}

function createEmploymentTableFilter() {
    const button = document.querySelector(".table-filter");

    if (!button) {
        return;
    }

    const options = ["All", "Employed", "Unemployed", "BSIT", "BSCS", "BSIS", "Recently Updated"];
    const menu = document.createElement("div");
    menu.className = "table-filter-menu";

    options.forEach((label, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = label;
        option.addEventListener("click", (event) => {
            event.stopPropagation();
            menu.querySelector(".active")?.classList.remove("active");
            option.classList.add("active");
            button.textContent = `${label} ▾`;
            menu.classList.remove("show");
            filterEmploymentRows(label);
        });

        if (index === 0) {
            option.classList.add("active");
        }

        menu.appendChild(option);
    });

    button.insertAdjacentElement("afterend", menu);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = menu.classList.contains("show");
        closeFilterMenus();
        closeAssistantMenu();
        menu.classList.toggle("show", !isOpen);
    });
}

function filterEmploymentRows(filter) {
    const rows = document.querySelectorAll(".employment-table tbody tr");
    let visibleCount = 0;

    rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        const course = cells[1].textContent.trim();
        const status = cells[3].textContent.trim();
        const date = cells[4].textContent.trim();
        const isVisible =
            filter === "All" ||
            filter.toUpperCase() === status ||
            filter === course ||
            (filter === "Recently Updated" && date === "02/11/26");

        row.classList.toggle("is-hidden", !isVisible);
        if (isVisible) {
            visibleCount += 1;
        }
    });

    showToast(`${visibleCount} employment record${visibleCount === 1 ? "" : "s"} shown.`);
}

document.querySelectorAll(".nav a").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        const navText = link.textContent.trim();
        const viewRoutes = {
            "Dashboard": "dashboard",
            "Alumni Employment Details": "employment",
            "Appointments": "appointments",
            "Manage Accounts": "accounts",
            "Post Announcements": "announcements",
            "Partnerships": "partnerships"
        };
        const targetView = viewRoutes[navText] || "dashboard";

        document.querySelector(".nav a.active")?.classList.remove("active");
        link.classList.add("active");
        pageTitle.textContent = navText;
        document.title = `${navText} | Tarlac State University`;
        document.querySelectorAll(".view").forEach((view) => {
            view.classList.toggle("active-view", view.dataset.view === targetView);
        });
        showToast(`${navText} selected`);
    });
});

sidebarToggle.addEventListener("click", () => {
    const isCollapsed = app.classList.toggle("sidebar-collapsed");
    sidebarToggle.setAttribute("aria-expanded", String(!isCollapsed));
    sidebarToggle.setAttribute("aria-label", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
});

sendButton.addEventListener("click", () => sendMessage());
assistantInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        sendMessage();
    }
});

chips.forEach((chip) => {
    chip.addEventListener("click", () => sendMessage(chip.textContent.trim()));
});

createChartFilterMenu(document.querySelector('[data-chart-filter="career"]'), careerSets, updateCareerChart);
createChartFilterMenu(document.querySelector('[data-chart-filter="employment"]'), employmentSets, updateEmploymentChart);
createEmploymentTableFilter();
document.addEventListener("click", () => {
    closeFilterMenus();
    closeAssistantMenu();
});

document.querySelectorAll(".bar-wrap").forEach((barWrap) => {
    const bar = barWrap.querySelector(".bar");
    const colorMap = {
        bsit: "#941527",
        bscs: "#dea045",
        bsis: "#eaaa63"
    };
    const colorClass = [...bar.classList].find((name) => colorMap[name]);

    addTooltip(barWrap, () => {
        const label = barWrap.querySelector(".bar-label").textContent.replace(/\s+/g, " ").trim();
        const value = bar.textContent;
        return `${label}: ${value} career alignment`;
    }, colorMap[colorClass]);
});

function showSegmentTooltip(event, text, color) {
    let tooltip = document.querySelector(".chart-tooltip");

    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        document.body.appendChild(tooltip);
    }

    tooltip.textContent = text;
    tooltip.style.background = color;
    moveTooltip(event, tooltip);
}

function addDonutSegmentTooltips(donut) {
    const segments = [
        { key: "employed", label: "Employed", color: "#941527" },
        { key: "unemployed", label: "Unemployed", color: "#eaaa63" },
        { key: "unidentified", label: "Unidentified", color: "#8f8f8f" }
    ];

    donut.addEventListener("mousemove", (event) => {
        const rect = donut.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        const distance = Math.sqrt(x * x + y * y);
        const outerRadius = rect.width / 2;
        const innerRadius = outerRadius * 0.46;

        if (distance < innerRadius || distance > outerRadius) {
            document.querySelector(".chart-tooltip")?.remove();
            return;
        }

        const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
        const percent = angle / 3.6;
        const data = employmentSets[employmentIndex];
        const segment =
            percent <= data.employed ? segments[0] :
            percent <= data.employed + data.unemployed ? segments[2] :
            segments[1];

        showSegmentTooltip(event, `${segment.label}: ${data[segment.key]}%`, segment.color);
    });

    donut.addEventListener("mouseleave", () => {
        document.querySelector(".chart-tooltip")?.remove();
    });
}

addDonutSegmentTooltips(document.querySelector(".donut"));

document.querySelectorAll(".legend-row").forEach((row) => {
    const swatch = row.querySelector(".swatch");
    const colorMap = {
        red: "#941527",
        gold: "#dea045",
        peach: "#eaaa63",
        gray: "#8f8f8f"
    };
    const colorClass = [...swatch.classList].find((name) => colorMap[name]);
    addTooltip(row, () => row.textContent.trim(), colorMap[colorClass]);
});

const assistantMenu = document.createElement("div");
assistantMenu.className = "assistant-menu";
assistantMenu.innerHTML = `
    <button type="button" data-assistant-option="help">Ask for help</button>
    <button type="button" data-assistant-option="clear">Clear chat</button>
    <button type="button" data-assistant-option="minimize">Minimize</button>
`;
assistantMenuButton.insertAdjacentElement("afterend", assistantMenu);

assistantMenuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = assistantMenu.classList.contains("show");
    closeFilterMenus();
    assistantMenu.classList.toggle("show", !isOpen);
    assistantMenuButton.setAttribute("aria-expanded", String(!isOpen));
});

assistantMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const option = event.target.closest("button")?.dataset.assistantOption;

    if (!option) {
        return;
    }

    if (option === "help") {
        assistantInput.value = "What can you help me with?";
        assistantInput.focus();
        showToast("Help prompt added.");
    }

    if (option === "clear") {
        assistantBody.querySelectorAll(".chat-row").forEach((row, index) => {
            if (index > 0) {
                row.remove();
            }
        });
        showToast("Assistant chat cleared.");
    }

    if (option === "minimize") {
        const isCollapsed = assistantPanel.classList.toggle("assistant-collapsed");
        const minimizeButton = assistantMenu.querySelector('[data-assistant-option="minimize"]');
        minimizeButton.textContent = isCollapsed ? "Restore" : "Minimize";
        showToast(isCollapsed ? "Assistant minimized." : "Assistant restored.");
    }

    closeAssistantMenu();
});

const reportFilters = [
    ["All", "Employed", "Unemployed", "Unidentified"],
    ["All", "BSIT", "TSM", "NA", "WMA", "BSCS", "BSIS"],
    ["All", "Completed", "Pending", "This Month"]
];

document.querySelectorAll("[data-report-filter]").forEach((button, index) => {
    createReportFilterMenu(button, reportFilters[index] || ["All", "This Month", "This Year"]);
});

document.querySelectorAll(".print").forEach((button) => {
    button.addEventListener("click", () => {
        const reportName = button.closest(".report-row").querySelector("span").textContent;
        showToast(`${reportName} is ready to print.`);
        window.print();
    });
});

const notificationsModal = document.querySelector('[data-modal="notifications-panel"]');
const settingsModal = document.querySelector('[data-modal="settings-panel"]');
const profileModal = document.querySelector('[data-modal="profile-panel"]');
const notificationButton = document.querySelector('[data-action="notifications"]');
const profileButton = document.querySelector('[data-action="profile"]');
const settingsButton = document.querySelector('[data-action="settings"]');
const settingsForm = document.querySelector(".settings-form");
const SETTINGS_KEY = "aptmsDashboardSettings";

function unreadNotificationCount() {
    return document.querySelectorAll(".notification-item.is-unread").length;
}

function notificationsEnabled() {
    return settingsForm.elements.dashboardNotifications.checked;
}

function updateNotificationBadge() {
    notificationButton.dataset.count = notificationsEnabled() ? String(unreadNotificationCount()) : "0";
}

function applyTheme(theme, shouldStore = true) {
    const mode = theme === "dark" ? "dark" : "light";
    document.body.classList.toggle("dark-mode", mode === "dark");
    const themeInput = settingsForm.querySelector(`[name="theme"][value="${mode}"]`);

    if (themeInput) {
        themeInput.checked = true;
    }

    if (shouldStore) {
        const savedSettings = loadSettings();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...savedSettings, theme: mode }));
    }
}

function loadSettings() {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
        return {};
    }
}

function saveSettings() {
    const settings = {
        theme: settingsForm.elements.theme.value,
        emailAlerts: settingsForm.elements.emailAlerts.checked,
        dashboardNotifications: settingsForm.elements.dashboardNotifications.checked,
        compactTables: settingsForm.elements.compactTables.checked
    };

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
}

function restoreSettings() {
    const settings = {
        theme: "light",
        emailAlerts: true,
        dashboardNotifications: true,
        compactTables: false,
        ...loadSettings()
    };

    settingsForm.elements.emailAlerts.checked = settings.emailAlerts;
    settingsForm.elements.dashboardNotifications.checked = settings.dashboardNotifications;
    settingsForm.elements.compactTables.checked = settings.compactTables;
    document.body.classList.toggle("compact-admin", settings.compactTables);
    applyTheme(settings.theme, false);
    updateNotificationBadge();
}

function openTopbarModal(modal, anchor) {
    closeTopbarModals();
    modal.classList.add("show");

    const panel = modal.querySelector(".topbar-modal");
    const rect = anchor.getBoundingClientRect();
    const panelWidth = Math.min(420, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.right - panelWidth), window.innerWidth - panelWidth - 16);
    const top = Math.min(rect.bottom + 12, window.innerHeight - 90);
    const arrowLeft = Math.min(Math.max(18, rect.left + rect.width / 2 - left - 7), panelWidth - 24);

    panel.style.width = `${panelWidth}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.setProperty("--popover-arrow-left", `${arrowLeft}px`);
}

function closeTopbarModals() {
    [notificationsModal, settingsModal, profileModal].forEach((modal) => modal.classList.remove("show"));
}

notificationButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openTopbarModal(notificationsModal, notificationButton);
});

settingsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openTopbarModal(settingsModal, settingsButton);
});

profileButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openTopbarModal(profileModal, profileButton);
});

document.querySelectorAll('[data-action="close-topbar-modal"]').forEach((button) => {
    button.addEventListener("click", closeTopbarModals);
});

[notificationsModal, settingsModal, profileModal].forEach((modal) => {
    modal.querySelector(".topbar-modal").addEventListener("click", (event) => {
        event.stopPropagation();
    });
});

document.addEventListener("click", closeTopbarModals);

document.querySelector('[data-action="mark-notifications-read"]').addEventListener("click", () => {
    document.querySelectorAll(".notification-item.is-unread").forEach((item) => item.classList.remove("is-unread"));
    updateNotificationBadge();
    showToast("Notifications marked as read.");
});

settingsForm.querySelectorAll('[name="theme"]').forEach((input) => {
    input.addEventListener("change", () => {
        applyTheme(input.value);
        showToast(`${input.value === "dark" ? "Dark" : "Light"} mode applied.`);
    });
});

settingsForm.elements.dashboardNotifications.addEventListener("change", updateNotificationBadge);

settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings = saveSettings();

    document.body.classList.toggle("compact-admin", settings.compactTables);
    applyTheme(settings.theme);
    updateNotificationBadge();
    closeTopbarModals();
    showToast("Settings saved.");
});

restoreSettings();

document.querySelector(".profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.name.value.trim() || "Admin User";
    const role = form.elements.role.value;
    const initial = name.charAt(0).toUpperCase();

    profileButton.textContent = initial;
    document.querySelector("[data-profile-preview]").textContent = initial;
    document.querySelector("[data-profile-display]").textContent = name;
    document.querySelector(".profile-summary span").textContent = role;
    closeTopbarModals();
    showToast("Admin profile updated.");
});

document.querySelectorAll(".day-pills button").forEach((button) => {
    button.addEventListener("click", () => {
        button.classList.toggle("active");
    });
});

document.querySelectorAll(".see-toggle").forEach((button) => {
    button.addEventListener("click", () => {
        const card = button.closest(`.${button.dataset.toggleTarget}`);
        const isExpanded = card.classList.toggle("is-expanded");
        button.textContent = isExpanded ? "Hide" : "See More";
    });
});

document.querySelector(".save-office").addEventListener("click", () => {
    const selectedDays = [...document.querySelectorAll(".day-pills button.active")].map((button) => button.textContent).join(", ");
    showToast(`Office availability saved for ${selectedDays || "no selected days"}.`);
});

document.querySelector(".edit-office").addEventListener("click", () => {
    document.querySelector(".office-form select").focus();
    showToast("Office availability is ready to edit.");
});

document.querySelector(".appointments-table").addEventListener("click", (event) => {
    const button = event.target.closest("button");

    if (!button) {
        return;
    }

    const row = button.closest("tr");
    const statusCell = row.children[3];

    if (button.classList.contains("delete-appointment")) {
        const name = row.children[1].textContent;
        row.remove();
        showToast(`${name} appointment deleted.`);
        return;
    }

    if (button.textContent.trim() === "Approve") {
        row.classList.remove("is-rejected");
        row.classList.add("is-approved");
        statusCell.textContent = "Approved";
        showToast(`${row.children[1].textContent} appointment approved.`);
    }

    if (button.textContent.trim() === "Reject") {
        row.classList.remove("is-approved");
        row.classList.add("is-rejected");
        statusCell.textContent = "Rejected";
        showToast(`${row.children[1].textContent} appointment rejected.`);
    }
});

function setAppointmentsEditing(isEditing) {
    const card = document.querySelector(".appointments-card");
    card.classList.toggle("is-editing", isEditing);
    const staffNames = [...document.querySelectorAll(".staff-list strong")].map((staff) => staff.textContent.trim());

    document.querySelectorAll(".appointments-table tbody tr").forEach((row) => {
        [...row.children].slice(0, 4).forEach((cell, index) => {
            cell.contentEditable = String(isEditing);

            if (index === 2) {
                cell.contentEditable = "false";

                if (isEditing && !cell.querySelector("select")) {
                    const currentStaff = cell.textContent.trim();
                    const select = document.createElement("select");
                    select.className = "staff-select";
                    select.innerHTML = staffNames
                        .map((name) => `<option${name === currentStaff ? " selected" : ""}>${name}</option>`)
                        .join("");
                    cell.textContent = "";
                    cell.appendChild(select);
                }

                if (!isEditing && cell.querySelector("select")) {
                    cell.textContent = cell.querySelector("select").value;
                }
            }
        });

        if (!row.querySelector(".delete-appointment")) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "delete-appointment";
            deleteButton.textContent = "Delete";
            row.lastElementChild.appendChild(deleteButton);
        }
    });

    showToast(isEditing ? "Appointment rows are editable." : "Appointment rows locked.");
}

document.querySelector('[data-action="edit-appointments"]').addEventListener("click", () => {
    setAppointmentsEditing(true);
});

document.querySelector('[data-action="save-appointments"]').addEventListener("click", () => {
    setAppointmentsEditing(false);
    showToast("Appointments saved.");
});

const quickEntryModal = document.querySelector('[data-modal="quick-entry"]');
const quickEntryTitle = document.querySelector("#quickEntryTitle");
const quickEntryForm = document.querySelector(".quick-entry-form");
let quickEntryMode = "staff";
let staffEditing = false;

function openQuickEntry(mode) {
    quickEntryMode = mode;
    quickEntryTitle.textContent = mode === "appointment" ? "Add Appointment" : "Add Staff";
    quickEntryForm.reset();
    quickEntryForm.querySelector('[name="detail"]').previousSibling.textContent = mode === "appointment" ? "Staff" : "Role";
    quickEntryModal.classList.add("show");
}

document.querySelector('[data-action="add-staff"]').addEventListener("click", () => openQuickEntry("staff"));
document.querySelector('[data-action="add-appointment"]').addEventListener("click", () => openQuickEntry("appointment"));
document.querySelector('[data-action="edit-staff"]').addEventListener("click", () => {
    staffEditing = !staffEditing;
    const staffList = document.querySelector(".staff-list");
    staffList.classList.toggle("is-editing", staffEditing);

    staffList.querySelectorAll("div").forEach((row) => {
        if (staffEditing && !row.querySelector(".delete-staff")) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "delete-staff";
            deleteButton.textContent = "Delete";
            row.appendChild(deleteButton);
        }

        if (!staffEditing) {
            row.querySelector(".delete-staff")?.remove();
        }
    });

    showToast(staffEditing ? "Staff edit mode enabled." : "Staff edit mode closed.");
});

document.querySelector(".staff-list").addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".delete-staff");
    if (!deleteButton) return;

    const row = deleteButton.closest("div");
    const name = row.querySelector("strong")?.textContent.trim() || "Staff";
    row.remove();
    showToast(`${name} removed from staff.`);
});

document.querySelectorAll('[data-action="close-entry"]').forEach((button) => {
    button.addEventListener("click", () => quickEntryModal.classList.remove("show"));
});

quickEntryModal.addEventListener("click", (event) => {
    if (event.target === quickEntryModal) {
        quickEntryModal.classList.remove("show");
    }
});

quickEntryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(quickEntryForm);
    const name = data.get("name");
    const detail = data.get("detail");
    const status = data.get("status");

    if (quickEntryMode === "staff") {
        const row = document.createElement("div");
        row.innerHTML = `<strong>${name}</strong><span>${detail}</span><em>${status}</em>`;
        if (staffEditing) {
            row.innerHTML += '<button type="button" class="delete-staff">Delete</button>';
        }
        document.querySelector(".staff-list").appendChild(row);
        showToast(`${name} added to staff.`);
    } else {
        const row = document.createElement("tr");
        row.innerHTML = `<td>New Schedule</td><td>${name}</td><td>${detail}</td><td>${status}</td><td><button type="button">Approve</button><button type="button">Reject</button><button type="button" class="delete-appointment">Delete</button></td>`;
        document.querySelector(".appointments-table tbody").appendChild(row);
        showToast(`${name} appointment added.`);
    }

    quickEntryModal.classList.remove("show");
});

const adminMenuChoices = {
    "accounts-role": ["All", "Admin", "Staff", "Alumni"],
    "accounts-status": ["All", "Active", "Pending", "Suspended"],
    "announcement-date": ["All", "Today", "This Month", "This Year"],
    "announcement-type": ["All", "News", "Event", "Career"],
    "post-category": ["News", "Event", "Career", "Scholarship"],
    "partner-type": ["All", "Industry", "Academe", "Government"],
    "partner-status": ["All", "Active", "Pending", "Archived"]
};

function closeAdminMenus() {
    document.querySelectorAll(".admin-menu.show").forEach((menu) => menu.classList.remove("show"));
}

document.querySelectorAll("[data-admin-menu]").forEach((button) => {
    const key = button.dataset.adminMenu;
    const menu = document.createElement("div");
    menu.className = "admin-menu";
    (adminMenuChoices[key] || ["All"]).forEach((choice) => {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = choice;
        option.addEventListener("click", (event) => {
            event.stopPropagation();
            button.textContent = choice;
            closeAdminMenus();
            filterAdminTable(button, choice);
        });
        menu.appendChild(option);
    });
    button.insertAdjacentElement("afterend", menu);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = menu.classList.contains("show");
        closeAdminMenus();
        menu.classList.toggle("show", !isOpen);
    });
});

document.addEventListener("click", closeAdminMenus);

function filterAdminTable(button, choice) {
    const table = button.closest(".admin-card")?.querySelector(".admin-table");
    if (!table) {
        showToast(`${choice} selected.`);
        return;
    }

    const key = button.dataset.adminMenu;
    const rows = table.querySelectorAll("tbody tr");
    let visibleCount = 0;

    rows.forEach((row) => {
        const text = row.textContent;
        const visible = choice === "All" || text.includes(choice);
        row.classList.toggle("is-hidden", !visible);
        if (visible) visibleCount += 1;
    });

    showToast(`${visibleCount} item${visibleCount === 1 ? "" : "s"} shown.`);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function accountActions(status) {
    if (status === "Pending") {
        return '<button type="button" data-account-action="edit">Edit</button><button type="button" data-account-action="approve">Approve</button><button type="button" data-account-action="reject">Reject</button><button type="button" data-account-action="delete">Delete</button>';
    }

    if (status === "Suspended") {
        return '<button type="button" data-account-action="edit">Edit</button><button type="button" data-account-action="approve">Activate</button><button type="button" data-account-action="delete">Delete</button>';
    }

    return '<button type="button" data-account-action="edit">Edit</button><button type="button" data-account-action="suspend">Suspend</button><button type="button" data-account-action="delete">Delete</button>';
}

function partnerActions(status) {
    if (status === "Pending") {
        return '<button type="button" data-partner-action="view">View</button><button type="button" data-partner-action="edit">Edit</button><button type="button" data-partner-action="approve">Approve</button><button type="button" data-partner-action="delete">Delete</button>';
    }

    if (status === "Archived") {
        return '<button type="button" data-partner-action="view">View</button><button type="button" data-partner-action="edit">Edit</button><button type="button" data-partner-action="approve">Activate</button><button type="button" data-partner-action="delete">Delete</button>';
    }

    return '<button type="button" data-partner-action="view">View</button><button type="button" data-partner-action="edit">Edit</button><button type="button" data-partner-action="archive">Archive</button><button type="button" data-partner-action="delete">Delete</button>';
}

function setAccountStatus(row, status) {
    row.children[3].textContent = status;
    row.children[4].innerHTML = accountActions(status);
}

function setPartnerStatus(row, status) {
    row.children[3].textContent = status;
    row.children[4].innerHTML = partnerActions(status);
}

document.querySelectorAll(".account-table tbody tr").forEach((row) => {
    row.children[4].innerHTML = accountActions(row.children[3].textContent.trim());
});

document.querySelectorAll(".partnership-table tbody tr").forEach((row) => {
    row.children[4].innerHTML = partnerActions(row.children[3].textContent.trim());
});

const adminEntryModal = document.querySelector('[data-modal="admin-entry"]');
const adminEntryTitle = document.querySelector("#adminEntryTitle");
const adminEntryForm = document.querySelector(".admin-entry-form");
const adminEntryFields = document.querySelector("[data-admin-entry-fields]");
let adminEntryMode = "account";
let adminEntryRow = null;

function optionList(options, selected) {
    return options
        .map((option) => `<option${option === selected ? " selected" : ""}>${option}</option>`)
        .join("");
}

function openAdminEntry(mode, row = null) {
    adminEntryMode = mode;
    adminEntryRow = row;
    const isEdit = Boolean(row);

    if (mode === "account") {
        const values = row
            ? [...row.children].slice(0, 4).map((cell) => cell.textContent.trim())
            : ["", "", "Alumni", "Active"];
        adminEntryTitle.textContent = isEdit ? "Edit Account" : "Add Account";
        adminEntryFields.innerHTML = `
            <label>Name<input type="text" name="name" value="${escapeHtml(values[0])}" required></label>
            <label>Email<input type="email" name="email" value="${escapeHtml(values[1])}" required></label>
            <label>Role<select name="role">${optionList(["Admin", "Staff", "Alumni"], values[2])}</select></label>
            <label>Status<select name="status">${optionList(["Active", "Pending", "Suspended"], values[3])}</select></label>
        `;
    }

    if (mode === "partnership") {
        const values = row
            ? [...row.children].slice(0, 4).map((cell) => cell.textContent.trim())
            : ["", "Industry", "", "Active"];
        adminEntryTitle.textContent = isEdit ? "Edit Partnership" : "Add Partnership";
        adminEntryFields.innerHTML = `
            <label>Partner<input type="text" name="partner" value="${escapeHtml(values[0])}" required></label>
            <label>Type<select name="type">${optionList(["Industry", "Academe", "Government"], values[1])}</select></label>
            <label>Contact<input type="email" name="contact" value="${escapeHtml(values[2])}" required></label>
            <label>Status<select name="status">${optionList(["Active", "Pending", "Archived"], values[3])}</select></label>
        `;
    }

    adminEntryModal.classList.add("show");
    adminEntryFields.querySelector("input, select")?.focus();
}

function closeAdminEntry() {
    adminEntryModal.classList.remove("show");
    adminEntryForm.reset();
    adminEntryRow = null;
}

document.querySelectorAll('[data-action="close-admin-entry"]').forEach((button) => {
    button.addEventListener("click", closeAdminEntry);
});

adminEntryModal.addEventListener("click", (event) => {
    if (event.target === adminEntryModal) {
        closeAdminEntry();
    }
});

adminEntryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(adminEntryForm);

    if (adminEntryMode === "account") {
        const name = data.get("name").trim();
        const email = data.get("email").trim();
        const role = data.get("role");
        const status = data.get("status");
        const row = adminEntryRow || document.createElement("tr");

        row.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(email)}</td><td>${escapeHtml(role)}</td><td>${escapeHtml(status)}</td><td>${accountActions(status)}</td>`;

        if (!adminEntryRow) {
            document.querySelector(".account-table tbody").prepend(row);
        }

        showToast(`${name} account saved.`);
    }

    if (adminEntryMode === "partnership") {
        const partner = data.get("partner").trim();
        const type = data.get("type");
        const contact = data.get("contact").trim();
        const status = data.get("status");
        const row = adminEntryRow || document.createElement("tr");

        row.innerHTML = `<td>${escapeHtml(partner)}</td><td>${escapeHtml(type)}</td><td>${escapeHtml(contact)}</td><td>${escapeHtml(status)}</td><td>${partnerActions(status)}</td>`;

        if (!adminEntryRow) {
            document.querySelector(".partnership-table tbody").prepend(row);
        }

        showToast(`${partner} partnership saved.`);
    }

    closeAdminEntry();
});

document.querySelector(".account-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-action]");
    if (!button) return;

    const row = button.closest("tr");
    const action = button.dataset.accountAction;
    const name = row.children[0].textContent.trim();

    if (action === "edit") {
        openAdminEntry("account", row);
        return;
    }

    if (action === "delete") {
        row.remove();
        showToast(`${name} account deleted.`);
        return;
    }

    if (action === "approve") setAccountStatus(row, "Active");
    if (action === "reject" || action === "suspend") setAccountStatus(row, action === "reject" ? "Suspended" : "Suspended");
    showToast(`${name}: ${action} action applied.`);
});

document.querySelector(".partnership-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-partner-action]");
    if (!button) return;

    const row = button.closest("tr");
    const action = button.dataset.partnerAction;
    const name = row.children[0].textContent.trim();

    if (action === "view" || action === "edit") {
        openAdminEntry("partnership", row);
        return;
    }

    if (action === "delete") {
        row.remove();
        showToast(`${name} partnership deleted.`);
        return;
    }

    if (action === "archive") setPartnerStatus(row, "Archived");
    if (action === "approve") setPartnerStatus(row, "Active");
    showToast(`${name}: ${action} action applied.`);
});

let activePostRow = null;
const postComposerModal = document.querySelector('[data-modal="post-composer"]');

function resetPostComposer() {
    activePostRow = null;
    document.querySelector('[data-post-field="title"]').value = "";
    document.querySelector('[data-post-field="description"]').value = "";
    document.querySelector('[data-action="post-announcement"]').textContent = "Post";
    document.querySelector(".composer-icon-action input")?.closest(".composer-icon-action")?.removeAttribute("data-file-name");
}

function openPostComposer(row = null) {
    activePostRow = row;

    if (row) {
        document.querySelector('[data-post-field="title"]').value = row.children[0].textContent.trim();
        document.querySelector('[data-post-field="description"]').value = row.children[1].textContent.trim();
        document.querySelector('[data-action="post-announcement"]').textContent = "Update";
    } else {
        resetPostComposer();
    }

    postComposerModal.classList.add("show");
    document.querySelector('[data-post-field="description"]').focus();
}

function closePostComposer() {
    postComposerModal.classList.remove("show");
}

function socialActionsHtml(likes = 0, comments = 0, shares = 0) {
    return `<div class="post-actions"><button type="button" data-social-action="like"><span data-svg-icon="icon-25"></span><span>${likes} Like</span></button><button type="button" data-social-action="comment"><span data-svg-icon="icon-26"></span><span>${comments} Comment</span></button><button type="button" data-social-action="share"><span data-svg-icon="icon-27"></span><span>${shares} Share</span></button></div>`;
}

function normalizeRecentPostActions() {
    document.querySelectorAll(".recent-posts article").forEach((article) => {
        if (article.querySelector(".post-actions")) return;
        article.dataset.likes = article.dataset.likes || "100";
        article.dataset.comments = article.dataset.comments || "45";
        article.dataset.shares = article.dataset.shares || "12";
        article.querySelector("p")?.remove();
        article.insertAdjacentHTML("beforeend", socialActionsHtml(article.dataset.likes, article.dataset.comments, article.dataset.shares));
    });
}

document.querySelectorAll('[data-action="open-post-composer"]').forEach((button) => {
    button.addEventListener("click", () => openPostComposer());
});

document.querySelector('[data-action="close-post-composer"]').addEventListener("click", closePostComposer);

postComposerModal.addEventListener("click", (event) => {
    if (event.target === postComposerModal) {
        closePostComposer();
    }
});

document.querySelector(".announcement-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-post-action]");
    if (!button) return;

    const row = button.closest("tr");
    const action = button.dataset.postAction;

    if (action === "edit") {
        openPostComposer(row);
        showToast("Post loaded in composer.");
        return;
    }

    if (action === "delete") {
        const title = row.children[0].textContent.trim();
        row.remove();
        if (activePostRow === row) resetPostComposer();
        showToast(`${title} deleted.`);
    }
});

document.querySelector('[data-action="post-announcement"]').addEventListener("click", () => {
    const titleInput = document.querySelector('[data-post-field="title"]');
    const descriptionInput = document.querySelector('[data-post-field="description"]');
    const title = titleInput.value.trim() || "Untitled Announcement";
    const description = descriptionInput.value.trim() || "No description provided yet.";
    const row = activePostRow || document.createElement("tr");

    row.innerHTML = `<td>${escapeHtml(title)}</td><td>${escapeHtml(description)}</td><td><button type="button" data-post-action="edit">Edit</button><button type="button" data-post-action="delete">Delete</button></td>`;

    if (!activePostRow) {
        document.querySelector(".announcement-table tbody").prepend(row);
        const recent = document.createElement("article");
        recent.dataset.likes = "0";
        recent.dataset.comments = "0";
        recent.dataset.shares = "0";
        recent.innerHTML = `<div class="post-art">${escapeHtml(title)}</div>${socialActionsHtml(0, 0, 0)}`;
        document.querySelector(".recent-posts").appendChild(recent);
    }

    showToast(activePostRow ? "Announcement updated." : "Announcement posted.");
    closePostComposer();
    resetPostComposer();
});

document.querySelector('[data-post-field="image"]').addEventListener("change", (event) => {
    const fileName = event.target.files[0]?.name;
    event.target.closest(".composer-icon-action")?.setAttribute("data-file-name", fileName || "");
    showToast(fileName ? `${fileName} attached.` : "Image removed.");
});

document.querySelector(".recent-posts").addEventListener("click", (event) => {
    const button = event.target.closest("[data-social-action]");
    if (!button) return;

    const article = button.closest("article");
    const action = button.dataset.socialAction;
    const key = action === "like" ? "likes" : action === "comment" ? "comments" : "shares";
    const nextValue = Number(article.dataset[key] || 0) + 1;

    article.dataset[key] = String(nextValue);
    button.classList.add("is-active");
    button.querySelector("span").textContent = `${nextValue} ${action.charAt(0).toUpperCase() + action.slice(1)}`;
    showToast(`${action.charAt(0).toUpperCase() + action.slice(1)} added.`);
});

normalizeRecentPostActions();

document.querySelector('[data-action="add-account"]').addEventListener("click", () => {
    openAdminEntry("account");
});

document.querySelector('[data-action="add-partnership"]').addEventListener("click", () => {
    openAdminEntry("partnership");
});

document.querySelector(".admin-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    const rows = document.querySelectorAll(".announcement-table tbody tr");
    let visibleCount = 0;

    rows.forEach((row) => {
        const visible = !query || row.textContent.toLowerCase().includes(query);
        row.classList.toggle("is-hidden", !visible);
        if (visible) visibleCount += 1;
    });

    showToast(`${visibleCount} post${visibleCount === 1 ? "" : "s"} shown.`);
});

document.querySelector('[data-action="export-employment"]').addEventListener("click", () => {
    const rows = [...document.querySelectorAll(".employment-table tbody tr:not(.is-hidden)")];
    const headers = [...document.querySelectorAll(".employment-table th")]
        .slice(0, 5)
        .map((header) => header.textContent.trim());
    const csvRows = [headers];

    rows.forEach((row) => {
        csvRows.push([...row.querySelectorAll("td")]
            .slice(0, 5)
            .map((cell) => cell.textContent.trim()));
    });

    const csv = csvRows
        .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "employment-details.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} employment record${rows.length === 1 ? "" : "s"} exported.`);
});

const tracerModal = document.querySelector('[data-modal="tracer"]');
const recordModal = document.querySelector('[data-modal="employment-record"]');
let activeRecord = null;

document.querySelector('[data-action="edit-tracer"]').addEventListener("click", () => {
    tracerModal.classList.add("show");
});

document.querySelectorAll('[data-action="close-tracer"]').forEach((button) => {
    button.addEventListener("click", () => tracerModal.classList.remove("show"));
});

tracerModal.addEventListener("click", (event) => {
    if (event.target === tracerModal) {
        tracerModal.classList.remove("show");
    }
});

document.querySelector(".tracer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    tracerModal.classList.remove("show");
    showToast("Tracer form changes saved.");
});

function getRecordFromRow(row) {
    const cells = [...row.querySelectorAll("td")].slice(0, 5);
    return {
        name: cells[0].textContent.trim(),
        course: cells[1].textContent.trim(),
        company: cells[2].textContent.trim(),
        status: cells[3].textContent.trim(),
        updated: cells[4].textContent.trim()
    };
}

function fillRecordModal(record) {
    Object.entries(record).forEach(([key, value]) => {
        const field = recordModal.querySelector(`[data-record-field="${key}"]`);
        if (field) {
            field.textContent = value;
        }
    });
}

function printEmploymentRecord(record) {
    const existingSheet = document.querySelector(".print-sheet");
    existingSheet?.remove();

    const sheet = document.createElement("section");
    sheet.className = "print-sheet";
    sheet.innerHTML = `
        <h1>Employment Record</h1>
        <table>
            <tbody>
                <tr><th>Name</th><td>${record.name}</td></tr>
                <tr><th>Course</th><td>${record.course}</td></tr>
                <tr><th>Company</th><td>${record.company}</td></tr>
                <tr><th>Status</th><td>${record.status}</td></tr>
                <tr><th>Last Updated</th><td>${record.updated}</td></tr>
            </tbody>
        </table>
    `;

    document.body.appendChild(sheet);
    window.print();
    setTimeout(() => sheet.remove(), 500);
}

document.querySelector(".employment-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-row-action]");

    if (!button) {
        return;
    }

    activeRecord = getRecordFromRow(button.closest("tr"));

    if (button.dataset.rowAction === "print") {
        printEmploymentRecord(activeRecord);
        showToast(`${activeRecord.name} record is ready to print.`);
    }

    if (button.dataset.rowAction === "view") {
        fillRecordModal(activeRecord);
        recordModal.classList.add("show");
    }
});

document.querySelectorAll('[data-action="close-record"]').forEach((button) => {
    button.addEventListener("click", () => recordModal.classList.remove("show"));
});

recordModal.addEventListener("click", (event) => {
    if (event.target === recordModal) {
        recordModal.classList.remove("show");
    }
});

document.querySelector('[data-action="print-record-modal"]').addEventListener("click", () => {
    if (activeRecord) {
        printEmploymentRecord(activeRecord);
        showToast(`${activeRecord.name} record is ready to print.`);
    }
});
