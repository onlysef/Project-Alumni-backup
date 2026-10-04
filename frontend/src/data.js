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
  "Good day. I am ATREIA, your AI assistant. How may I assist you today?\nYou may inquire about alumni records, tracer surveys, or employment data.",
  "Good day. I am ATREIA. I am able to assist you in reviewing alumni records, employment status, and tracer survey results.",
  "Welcome back. I am ATREIA, your AI assistant for tracer records and graduate employment insights.",
  "Good day. I am ATREIA. You may ask about alumni profiles, course alignment, survey completion, or employment outcomes.",
];

export function assistantReply(message) {
  const n = message.toLowerCase();
  if (n.includes("record"))
    return "### Alumni Records\n\nThere are **400 alumni records** in the dashboard. You can organize them using these filters:\n\n- Course or program\n- Employment status\n- Tracer submission date";
  if (n.includes("survey") || n.includes("tracer"))
    return "### Tracer Survey Activity\n\n- Recent submissions: **100**\n- Latest activity: newest alumni engagement updates\n- Available views: completed, pending, and recent responses";
  if (n.includes("employment") || n.includes("employed"))
    return "### Employment Summary\n\nThe dashboard contains **260 alumni employment records**.\n\n| Status | Alumni | Share |\n| :--- | ---: | ---: |\n| Employed | 169 | 65% |\n| Unemployed | 52 | 20% |\n| Unidentified | 39 | 15% |\n\n1. Review unidentified records first.\n2. Use the employment chart to compare each status.\n3. Filter by course for a more focused breakdown.";
  if (n.includes("job") || n.includes("opportunit"))
    return "ATREIA is focused on tracer-study data. I can help with alumni records, survey responses, employment status, and course-related employment outcomes.";
  return "### What I can help with\n\n- Alumni records\n- Tracer surveys\n- Employment status\n- Course-related employment outcomes\n\nTry one of the quick buttons or ask a question about these areas.";
}

export function currentTime() {
  return new Date()
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

export const viewRoutes = {
  
  dashboard: "Dashboard",
  employment: "Alumni Record",
  appointments: "Appointments",
  accounts: "Manage Accounts",
  announcements: "Post Announcements",
  partnerships: "Partnerships",
  aiassistant: "ATREIA - AI Assistant",
  about: "Alumni Association, Inc.",
};

export const navGroups = [
  {
    group: "Overview",
    items: [
      { view: "dashboard", icon: "icon-1", label: "Dashboard" },
    ],
  },
  {
    group: "Tracer Study",
    items: [
      { view: "tracer-dashboard", icon: "icon-14", label: "Tracer Dashboard" },
      { view: "tracer-responses", icon: "icon-20", label: "Tracer Responses" },
      { view: "tracer-form-editor", icon: "icon-18", label: "Edit Tracer Form" },
    ],
  },
  {
    group: "Alumni Management",
    items: [
      { view: "employment", icon: "icon-2", label: "Alumni Record" },
      { view: "export-employment", icon: "icon-17", label: "Export Alumni Record" },
      { view: "notify-alumni", icon: "icon-9", label: "Notify Alumni" },
    ],
  },
  {
    group: "Community",
    items: [
      { view: "appointments", icon: "icon-3", label: "Appointments" },
      { view: "announcements", icon: "icon-5", label: "Post Announcements" },
      { view: "partnerships", icon: "icon-6", label: "Partnerships" },
    ],
  },
  {
    group: "System",
    items: [
      { view: "accounts", icon: "icon-4", label: "Manage Accounts", children: [
          { key: "Admin", label: "Admin" },
          { key: "Alumni", label: "Alumni" },
          { key: "Coordinator", label: "Coordinator" },
          { key: "Employer", label: "Employer" },
      ] },
      { view: "aiassistant", icon: "icon-15", label: "ATREIA - AI Assistant" },
    ],
  },
];

// Flat list, derived from navGroups — kept for any code that just needs to
// look up a nav item by view without caring about grouping.
export const navItems = navGroups.flatMap((g) => g.items);

export const adminMenuChoices = {
  "accounts-role": ["All", "Admin", "Alumni", "Coordinator", "Employer"],
  "accounts-status": ["All", "Active", "Pending", "Suspended"],
  "announcement-date": ["All", "Today", "This Month", "This Year"],
  "announcement-type": ["All", "News", "Announcement", "Job Posting", "Event"],
  "partner-type": [
    "All",
    "Information Technology & BPO",
    "Manufacturing",
    "Banking & Finance",
    "Healthcare",
    "Retail & Trade",
    "Education",
    "Government",
    "Construction & Engineering",
    "Hospitality & Tourism",
    "Agriculture",
    "Others",
  ],
  "partner-status": ["All", "Active", "Pending", "Archived"],
  "job-source": ["All", "TSU Partner", "Careerjet"],
  "job-course": ["All", "BSIT", "BSCS", "BSIS"],
  "job-row-open": ["View", "Deactivate"],
  "job-row-closed": ["View", "Activate"],
};

export const reportFilters = [
  ["All", "Employed", "Unemployed", "Unidentified"],
  ["All", "BSIT", "TSM", "NA", "WMA", "BSCS", "BSIS", "BSIM"],
  ["All", "Completed", "Pending", "This Month"],
];

export function accountActionList(status, role) {
  if (status === "Pending") {
    // No Approve/Reject for alumni/coordinator accounts; they activate on first login.
    const canApprove = role !== "Alumni" && role !== "Coordinator";
    return canApprove ? ["edit", "approve", "resend"] : ["edit", "resend"];
  }
  if (status === "Suspended") return ["edit", "unsuspend"];
  return ["edit", "suspend"];
}

export function partnerActionList(status) {
  if (status === "Pending") return ["view", "edit", "approve"];
  if (status === "Archived") return ["view", "edit", "activate"];
  return ["view", "edit", "archive"];
}

export const actionLabels = {
  edit: "Edit",
  approve: "Approve",
  reject: "Reject",
  delete: "Delete",
  suspend: "Suspend",
  activate: "Activate",
  unsuspend: "Unsuspend",
  view: "View",
  print: "Download",
  complete: "Complete",
  cancel: "Cancel",
  resend: "Resend Credentials",
  archive: "Archive",
};
