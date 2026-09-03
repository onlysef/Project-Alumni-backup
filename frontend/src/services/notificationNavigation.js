const ALUMNI_EVENT_TYPES = new Set(["event", "reminder_due", "reminder_set"]);
const COORDINATOR_EVENT_TYPES = new Set(["interested", "attendance", "event"]);

function withReference(path, notification) {
  const reference = notification.event_id || notification.resource_id || notification.target_id;
  if (!reference) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}notification=${encodeURIComponent(reference)}`;
}

/* Resolve a notification to a page the signed-in role is allowed to open. */
export function getNotificationTarget(role, notification) {
  if (notification.target_url?.startsWith("/")) return notification.target_url;

  const type = String(notification.type || "").toLowerCase();

  if (role === "admin") {
    const paths = {
      pending_user: "/admin/accounts",
      employment: "/admin/employment",
      partnership: "/admin/partnerships",
      announcement: "/admin/announcements",
      like: "/admin/announcements",
      comment: "/admin/announcements",
      share: "/admin/announcements",
      appointment: "/admin/appointments",
    };
    return withReference(paths[type] || "/admin/dashboard", notification);
  }

  if (role === "coordinator") {
    if (COORDINATOR_EVENT_TYPES.has(type)) {
      return withReference(type === "attendance" ? "/coordinator/participation" : "/coordinator/events", notification);
    }
    if (type === "employment") return "/coordinator/employment";
    if (type === "contact" || type === "alumni") return "/coordinator/contacts";
    return "/coordinator/dashboard";
  }

  if (role === "employer") {
    if (["applicant", "application", "job_application"].includes(type)) return "/employer/applicants";
    if (type === "appointment") return "/employer/appointments";
    return "/employer/dashboard";
  }

  if (ALUMNI_EVENT_TYPES.has(type)) {
    return withReference("/alumni/dashboard?section=announcements&filter=Events", notification);
  }
  if (type === "job_alert" || type === "job") return "/alumni/dashboard?section=jobconnect";
  if (type === "appointment") return "/alumni/dashboard?section=office";
  if (["announcement", "like", "comment", "share"].includes(type)) {
    return withReference("/alumni/dashboard?section=announcements", notification);
  }
  if (type === "employment") return "/alumni/dashboard?section=employment";
  return "/alumni/dashboard";
}
