# Alumni Tracer System — TSU College of Computer Studies

AI-powered alumni management system for Tarlac State University. Tracks alumni employment, events, appointments, and tracer study data.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5, React Router DOM v7 |
| Backend | Node.js + Express |
| Database | MongoDB (Atlas) + Mongoose |
| Auth | JWT (stored in localStorage) |
| Email | Nodemailer (SMTP) |
| Deployment | Vercel (frontend + backend) |

---

## Project Structure

```
Project-Alumni/
├── backend/
│   ├── controllers/       # Route handlers
│   ├── models/            # Mongoose schemas
│   ├── routes/            # Express routers
│   ├── utils/             # Email service
│   ├── config/db.js       # MongoDB connection
│   └── server.js
├── frontend/
│   ├── public/            # Static login/2FA HTML pages
│   │   ├── alumni-login.html
│   │   ├── alumni-2fa.html
│   │   └── alumni-reset-pass.html
│   └── src/
│       ├── assets/css/    # Global stylesheets
│       ├── assets/images/ # Logo files
│       ├── components/
│       │   ├── admin/     # AdminSidebar, AdminTopbar
│       │   ├── coordinator/ # CoordinatorSidebar, CoordinatorTopbar
│       │   └── common/    # Icon, Primitives, Charts
│       ├── context/       # AuthContext (JWT)
│       ├── layouts/       # AdminLayout, CoordinatorLayout, AlumniLayout, EmployerLayout
│       ├── pages/
│       │   ├── admin/
│       │   ├── coordinator/
│       │   ├── alumni/
│       │   └── employer/
│       ├── routes/        # AppRoutes, ProtectedRoute
│       ├── services/      # api.js (base URL)
│       └── data.js        # Nav items, static data
├── package.json           # Root — runs backend + frontend concurrently
└── .gitignore
```

---

## Running Locally

```bash
# Install dependencies
npm install
npm --prefix backend install
npm --prefix frontend install

# Run backend + frontend together
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000/api`
- Login page: `http://localhost:5173/alumni-login.html`

---

## Roles & Routes

| Role | Dashboard Route | Description |
|------|----------------|-------------|
| Admin | `/admin/dashboard` | Full system management |
| Coordinator | `/coordinator/dashboard` | Event & alumni coordination |
| Alumni | `/alumni/dashboard` | Personal portal |
| Employer | `/employer/dashboard` | Job posting portal |

Login redirects to the correct dashboard based on role. All routes are protected — unauthenticated users are redirected to the login page.

---

## Authentication Flow

1. User logs in via `alumni-login.html`
2. Backend returns JWT + user object
3. Login page redirects to `/<role>/dashboard#auth=<encoded-payload>`
4. React app reads the `#auth=` hash, stores token in `localStorage`, clears the hash
5. `ProtectedRoute` checks token + role on every route

Alumni first-login flow:
- `firstLogin: true` → redirect to `/alumni/onboarding` (change password)
- After onboarding → redirect to `/alumni/tracer-study` (if not yet completed)
- After tracer study → `/alumni/dashboard`

---

## Backend API Routes

### Auth (`/api/auth`)
- `POST /login` — login, returns JWT
- `POST /verify-2fa` — verify OTP
- `POST /request-reset` — send password reset email
- `POST /reset-password` — reset with token

### Admin (`/api/admin`)
- `GET/POST /users` — list / create accounts
- `PATCH/DELETE /users/:id` — update / delete (cascade deletes all related records)
- `POST /users/import` — bulk import via Excel/CSV
- `GET/POST /announcements` — list / create
- `PATCH/DELETE /announcements/:id` — edit / delete
- `POST /announcements/:id/like|comment|share`
- `GET/POST /appointments` — manage appointments
- `GET/POST /partnerships` — manage employer partnerships
- `GET /employment` — alumni employment overview
- `GET /dashboard` — stats summary
- `GET /notifications` — admin notification feed

### Coordinator (`/api/coordinator`)
- `GET /dashboard` — stats (events, alumni, employment)
- `GET/POST /events` — event management
- `GET /events/:id/participants` — attendance
- `POST /events/:id/attendance` — mark attendance
- `GET /employment` — employment details view
- `GET /contacts` — alumni contact list
- `GET /notifications` — coordinator notifications

### Alumni (`/api/alumni`)
- `POST /change-password` — onboarding password change
- `POST /complete-onboarding` — mark first login done
- `GET/POST /tracer-study` — tracer study form

### Employer (`/api/employer`)
- Employer dashboard data

---

## Database Collections

| Collection | Purpose |
|-----------|---------|
| `users` | All accounts (admin, alumni, coordinator, employer) |
| `alumniemployments` | Employment details per alumni |
| `tracerstudyresponses` | Tracer study form answers |
| `tracerformquestions` | Admin-configurable tracer form questions |
| `tracerformconfigs` | Tracer form settings |
| `announcements` | Posts with likes, comments, shares |
| `appointments` | Appointment bookings |
| `staffs` | Staff available for appointments |
| `events` | Coordinator-managed events |
| `attendancelogs` | Event attendance records |
| `eventinteresteds` | Alumni interest in events |
| `eventfeedbacks` | Post-event feedback |
| `partnerships` | Employer partnership records |
| `jobs` | Job postings |
| `notifications` | In-app notifications |
| `activitylogs` | User activity feed |
| `employmentactivities` | Employment update history |
| `officesettings` | System-wide settings |

> Cascade delete: deleting a user also removes their employment, tracer response, appointments, attendance logs, event feedback, activity logs, and notifications.

---

## Admin Features

- **Dashboard** — stats overview, employment chart, activity feed, announcements
- **Alumni Employment** — searchable/filterable table, export CSV, tracer form editor
- **Appointments** — booking management, staff assignment, schedule settings
- **Manage Accounts** — create/edit/delete users, bulk import via Excel, role filter
- **Announcements** — inline quick post, full composer modal (image, emoji, location), like/comment/share
- **Partnerships** — employer partner management
- **AI Assistant** — AI chatbot for alumni data queries
- **About** — alumni association info

## Coordinator Features

- **Dashboard** — event stats, alumni activity, employment summary
- **Event Management** — create/edit/delete events, capacity management
- **Event Participation** — attendance tracking, QR/manual check-in
- **Employment Details** — read-only employment view with export
- **Alumni Contacts** — searchable alumni directory

## Alumni Features

- **Onboarding** — first-login password change
- **Tracer Study Form** — dynamic form (questions configurable by admin)
- **Dashboard** — personal alumni portal *(in development)*

## Employer Features

- **Dashboard** — *(in development)*

---

## Environment Variables

### Backend (`.env`)
```
MONGODB_URI=
JWT_SECRET=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
FRONTEND_URL=
```

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:5000/api
```

---

## Deployment

- **Backend**: Vercel serverless (`vercel.json` in `/backend`)
- **Frontend**: Vercel static (`vercel.json` in `/frontend`)
- **Production API**: `https://project-alumni-phi.vercel.app/api`
- **Production Frontend**: `https://project-alumni-frontend.vercel.app`
