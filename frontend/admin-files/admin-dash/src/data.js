// Static data + helpers ported from admin-mod.js

export const careerSets = [
  { label: "All", values: [50, 45, 35], legends: ["BSIT - 50%", "BSCS - 45%", "BSIS - 35%"] },
  { label: "This Month", values: [58, 49, 41], legends: ["BSIT - 58%", "BSCS - 49%", "BSIS - 41%"] },
  { label: "This Year", values: [62, 54, 44], legends: ["BSIT - 62%", "BSCS - 54%", "BSIS - 44%"] },
];

export const employmentSets = [
  { label: "All", employed: 65, unemployed: 20, unidentified: 15, count: 260 },
  { label: "Recent", employed: 72, unemployed: 18, unidentified: 10, count: 288 },
  { label: "Verified", employed: 80, unemployed: 12, unidentified: 8, count: 320 },
];

export const assistantGreetings = [
  "Hello! I'm AC, your AI chatbot. How may I assist you today?\nYou may ask about alumni records, tracer surveys, or job opportunities.",
  "Hi, I'm AC. I can help you review alumni records, employment status, tracer surveys, and recent activities.",
  "Welcome back. I'm AC, your AI assistant for alumni records, reports, appointments, and employment insights.",
  "Good day! I'm AC. Ask me about alumni profiles, course alignment, survey completion, or job opportunities.",
];

export function assistantReply(message) {
  const n = message.toLowerCase();
  if (n.includes("record"))
    return "There are 400 alumni records in the dashboard. You can filter them by course, employment status, or tracer submission date.";
  if (n.includes("survey") || n.includes("tracer"))
    return "There are 100 recent tracer submissions. The latest activity list shows the newest alumni engagement updates.";
  if (n.includes("employment") || n.includes("employed"))
    return "260 alumni are currently marked as employed, with the distribution chart showing employed, unemployed, and unidentified records.";
  if (n.includes("job") || n.includes("opportunit"))
    return "You can review job fair posts, internships, and career webinar activity from the recent post panel.";
  return "I can help with alumni records, tracer surveys, employment status, and job opportunities. Try one of the quick buttons below.";
}

export function currentTime() {
  return new Date()
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

export const viewRoutes = {
  dashboard: "Dashboard",
  employment: "Alumni Employment Details",
  appointments: "Appointments",
  accounts: "Manage Accounts",
  announcements: "Post Announcements",
  partnerships: "Partnerships",
};

export const navItems = [
  { view: "dashboard", icon: "icon-1", label: "Dashboard" },
  { view: "employment", icon: "icon-2", label: "Alumni Employment Details" },
  { view: "appointments", icon: "icon-3", label: "Appointments" },
  { view: "accounts", icon: "icon-4", label: "Manage Accounts" },
  { view: "announcements", icon: "icon-5", label: "Post Announcements" },
  { view: "partnerships", icon: "icon-6", label: "Partnerships" },
];

export const adminMenuChoices = {
  "accounts-role": ["All", "Admin", "Staff", "Alumni"],
  "accounts-status": ["All", "Active", "Pending", "Suspended"],
  "announcement-date": ["All", "Today", "This Month", "This Year"],
  "announcement-type": ["All", "News", "Event", "Career"],
  "post-category": ["News", "Event", "Career", "Scholarship"],
  "partner-type": ["All", "Industry", "Academe", "Government"],
  "partner-status": ["All", "Active", "Pending", "Archived"],
};

export const reportFilters = [
  ["All", "Employed", "Unemployed", "Unidentified"],
  ["All", "BSIT", "TSM", "NA", "WMA", "BSCS", "BSIS"],
  ["All", "Completed", "Pending", "This Month"],
];

export function accountActionList(status) {
  if (status === "Pending") return ["edit", "approve", "reject", "delete"];
  if (status === "Suspended") return ["edit", "activate", "delete"];
  return ["edit", "suspend", "delete"];
}

export function partnerActionList(status) {
  if (status === "Pending") return ["view", "edit", "approve", "delete"];
  if (status === "Archived") return ["view", "edit", "activate", "delete"];
  return ["view", "edit", "archive", "delete"];
}

export const actionLabels = {
  edit: "Edit",
  approve: "Approve",
  reject: "Reject",
  delete: "Delete",
  suspend: "Suspend",
  activate: "Activate",
  view: "View",
  archive: "Archive",
};
