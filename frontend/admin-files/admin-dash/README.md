# AI-Powered Alumni Tracer Management System

A React + Vite single-page admin app. Each admin page now lives in its own file.

## Project structure

```
alumni-tracer/
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
└── src/
    ├── main.jsx              # App bootstrap (mounts <App/>, loads global CSS)
    ├── App.jsx               # Shell: sidebar + topbar + switches between pages
    ├── shared.js             # Shared helpers (nextId)
    │
    ├── layout/
    │   ├── Sidebar.jsx       # Left navigation
    │   └── Topbar.jsx        # Top bar + notifications/settings/profile popovers
    │
    ├── pages/                # ONE FILE PER PAGE
    │   ├── DashboardView.jsx     # Dashboard (+ AI Assistant panel)
    │   ├── EmploymentView.jsx    # Alumni Employment
    │   ├── AppointmentsView.jsx  # Appointments (+ QuickEntry modal)
    │   ├── AccountsView.jsx      # Accounts (+ shared AdminEntry modal)
    │   ├── PartnershipsView.jsx  # Partnerships
    │   └── AnnouncementsView.jsx # Announcements (+ Post composer modal)
    │
    ├── Charts.jsx            # Career / employment charts
    ├── Primitives.jsx        # Reusable Dropdown + Modal
    ├── Icon.jsx              # <Icon> wrapper
    ├── iconData.js           # Inline SVG icon definitions
    ├── data.js               # Static data + helpers
    ├── admin-mod.css         # Main stylesheet
    ├── icon-overrides.css    # Icon sizing overrides
    └── logo/                 # Image assets
```

### How pages connect

`App.jsx` keeps the current page in a `view` state. Clicking an item in the
Sidebar calls `selectView(...)`, which updates `view`. Each page component
(e.g. `EmploymentView`) receives `active={view === "employment"}` and shows
itself only when active. To edit one page, open just that file in `src/pages/`.

Adding a new page:
1. Create `src/pages/MyView.jsx` exporting a default component.
2. Import it in `App.jsx` and render `<MyView active={view === "myview"} ... />`.
3. Add a nav entry in `data.js` (`navItems`) and a label in `viewRoutes`.

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev
```

## Build for production

```bash
npm run build
npm run preview
```
