# Alumni Tracer System — TSU College of Computer Studies

AI-powered alumni management system for Tarlac State University. Tracks alumni employment, events, appointments, job connections, and tracer study data, with a RAG-based AI assistant over alumni/tracer data for staff.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5, React Router DOM v7 |
| Backend | Node.js + Express |
| Database | MongoDB (Atlas) + Mongoose |
| Auth | JWT (stored in localStorage), 2FA via email OTP |
| AI Assistant | Hugging Face inference (chat) + custom RAG pipeline (embeddings, retrieval, answer cache) |
| Email | Nodemailer (Gmail SMTP) |
| Deployment | Vercel (frontend + backend) |

---

## Project Structure

```
Project-Alumni/
├── backend/
│   ├── controllers/       # Route handlers
│   ├── models/             # Mongoose schemas
│   ├── routes/              # Express routers (admin, coordinator, alumni, employer, auth, ai)
│   ├── services/            # RAG pipeline (embeddings, retrieval, answer cache), job alerts, Careerjet integration
│   ├── utils/                # Email service, file parsing, skill matching, resume builder, etc.
│   ├── middleware/           # Auth guard, rate limiting
│   ├── config/db.js          # MongoDB connection
│   └── server.js
├── frontend/
│   ├── public/               # Static login/2FA/reset HTML pages
│   │   ├── alumni-login.html
│   │   ├── alumni-2fa.html
│   │   └── alumni-reset-pass.html
│   └── src/
│       ├── assets/css/       # Global stylesheets
│       ├── assets/images/    # Logo files
│       ├── components/
│       │   ├── admin/        # AdminSidebar, AdminTopbar
│       │   ├── coordinator/  # CoordinatorSidebar, CoordinatorTopbar
│       │   └── common/       # Icon, Primitives, Charts
│       ├── context/           # AuthContext (JWT)
│       ├── layouts/           # AdminLayout, CoordinatorLayout, AlumniLayout, EmployerLayout
│       ├── pages/
│       │   ├── admin/         # Dashboard, accounts, announcements, partnerships, employment/tracer, AI assistant
│       │   ├── coordinator/   # Dashboard, events, attendance, employment, contacts
│       │   ├── alumni/        # Dashboard, job connect, career recommendations, tracer study, networking
│       │   └── employer/      # Dashboard, applicants, appointments
│       ├── routes/            # AppRoutes, ProtectedRoute
│       ├── services/          # api.js (base URL)
│       └── data.js            # Nav items, static data
├── package.json               # Root — runs backend + frontend concurrently
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
| Employer | `/employer/dashboard` | Job posting & applicant portal |

Login redirects to the correct dashboard based on role. All routes are protected — unauthenticated users are redirected to the login page.

---

## Authentication Flow

1. User logs in via `alumni-login.html`
2. Backend returns JWT + user object (2FA via email OTP for applicable roles)
3. Login page redirects to `/<role>/dashboard#auth=<encoded-payload>`
4. React app reads the `#auth=` hash, stores token in `localStorage`, clears the hash
5. `ProtectedRoute` checks token + role on every route

Alumni first-login flow:
- `firstLogin: true` → redirect to `/alumni/onboarding` (change password)
- After onboarding → redirect to `/alumni/tracer-study` (if not yet completed)
- After tracer study → `/alumni/dashboard`

Employer accounts are created via an email-locked invite link generated on the admin Partnerships page (`/employer-signup`), not self-registration.

---

## Backend API Routes

### Auth (`/api/auth`)
- `POST /login` — login, returns JWT
- `POST /verify-2fa` / `POST /resend-2fa` — OTP verification
- `POST /forgot-password` / `POST /verify-reset-otp` / `POST /reset-password` — password reset flow
- `POST /enable-2fa` / `POST /disable-2fa` — toggle 2FA
- `GET /employer-invite/:token` — validate an employer invite link
- `POST /register-partner` / `POST /register-alumni` — account registration

### Admin (`/api/admin`)
- `GET/POST /users`, `PATCH/DELETE /users/:id` — manage accounts (cascade deletes related records)
- `POST /users/import` — bulk import via Excel/CSV
- `PATCH /users/bulk-status`, `POST /users/:id/resend-credentials`
- `GET/POST /announcements`, `PATCH/DELETE /announcements/:id` — posts, plus like/comment/share
- `GET /announcements/activity` — recent post activity feed (`hours`/`limit` query params)
- `GET/POST /partnerships`, `PATCH/DELETE /partnerships/:id` — employer partnerships
- `GET/POST /employer-invites`, `DELETE /employer-invites/:id` — employer signup invites
- `GET /jobs` — all job postings (oversight)
- `GET/POST /employment`, `GET/PATCH /employment/:id` — alumni employment records
- `GET /employment/activity` — recent employment activity feed (`hours`/`limit` query params)
- `GET /employment/stats|donut-stats|course-stats|survey-stats|tracer-analytics` — dashboards/analytics
- `GET /employment/export`, `GET /employment/tracer-analytics/export` — CSV export
- `GET/POST/PATCH/DELETE /employment/tracer-questions` — tracer form question builder
- `GET/PUT /tracer-form-config`, `POST /tracer-form-config/import-google-form`
- `GET /employment/responses`, `GET /employment/responses/:alumni_id` — tracer study responses
- `POST /employment/notify`, `GET /employment/notify-candidates` — nudge alumni to update records
- `POST /skills/extract` — AI skill extraction
- `GET/POST/PATCH/DELETE /appointments`, `/appointments/staff`, `/appointments/settings`
- `GET /dashboard` — stats summary
- `GET /notifications` — admin notification feed

### AI Assistant (`/api/ai`)
- `POST /chat` — RAG-based chat over alumni/tracer data (rate-limited, prompt-sanitized, streamed via SSE)
- `POST /ingest`, `GET /ingest/status/:id` — upload/import source documents (admin)
- `GET /sources`, `DELETE /sources/:id` — manage ingested knowledge sources (admin)
- `POST /reembed` — rebuild embeddings (admin)
- `GET /flags`, `PATCH /flags/:id` — review flagged/uncertain AI answers (admin)

### Coordinator (`/api/coordinator`)
- `GET /dashboard`, `GET /dashboard/activity`, `GET /events-dashboard`, `GET /reports/:type` — stats
- `GET/POST/PUT/DELETE /events`, `GET /events/:id/interested` — event management
- `GET /attendance/events`, `GET /attendance/alumni-search`, `POST /attendance`, `PATCH/DELETE /attendance/:id`
- `GET /attendance/:eventId/records|stats|details|export|feedback` — attendance & feedback reporting
- `GET/PATCH /employment`, `/employment/:id` — employment details view (read/scoped write access)
- `GET /employment/activity` — recent employment activity feed (`hours`/`limit` query params)
- `GET /employment/tracer-analytics|donut-stats|tracer-filter-options`, `GET/PUT /tracer-form-config`
- `GET /alumni` — alumni directory / contacts
- `GET /notifications`, `PATCH /notifications/read`

### Alumni (`/api/alumni`)
- `POST /change-password`, `POST /complete-onboarding` — onboarding
- `GET/POST /tracer-study`, `GET /tracer-form-config` — tracer study form
- `GET /home-summary` — dashboard summary
- `GET /suggested`, `POST /network/:id/message` — alumni networking/suggestions
- `GET /career-recommendations`, `/career-recommendations/next-step`, `/career-recommendations/explain` — AI career guidance
- `GET /jobs/search`, `/jobs/partner-postings`, `/jobs/skill-tip`, `/jobs/saved`, `POST /jobs/saved/toggle`
- `GET/PUT /job-alerts` — job alert preferences
- `GET/PUT/DELETE /resume`, `PUT/DELETE /resume/file` — resume builder/upload
- `GET/POST /applications`, `PATCH /applications/:id/status`, `DELETE /applications/:id` — job application tracker
- `GET/PUT /employment` — self-reported employment
- `POST /skills/extract` — AI skill extraction
- `PUT /password`, `PUT /avatar`
- `POST /inquiry` — contact the alumni office
- `GET /appointments/settings|staff|booked-slots`, `POST /appointments` — book appointments
- `GET /announcements`, like/comment/share
- `GET /events`, `POST /events/:id/interested`, `GET/POST /events/:id/feedback`
- `GET /notifications`, `PATCH /notifications/read`

### Employer (`/api/employer`)
- `GET /partnerships` — active partnerships
- `GET/POST/PATCH/DELETE /jobs`, `PATCH /jobs/:id/close` — job posting management
- `GET /applicants`, `PATCH /applicants/:id/status`, `GET /applicants/:id/resume`, `POST /applicants/:id/message`
- `GET/POST/PATCH/DELETE /interviews`, `PATCH /interviews/:id/cancel` — interview scheduling
- `GET /notifications`, `PATCH /notifications/read`

---

## Database Collections

| Collection | Purpose |
|-----------|---------|
| `users` | All accounts (admin, alumni, coordinator, employer) |
| `graduates` | Alumni-only tracer/employment data mirror used by the AI assistant |
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
| `employerinvites` | Email-locked employer signup invite links |
| `jobs` | Job postings |
| `jobapplications` | Alumni job application tracker entries |
| `savedjobs` | Alumni-saved job postings |
| `jobalertseens` | Job alert de-duplication tracking |
| `interviews` | Employer-scheduled interviews |
| `resumes` | Alumni resume builder data/files |
| `notifications` | In-app notifications |
| `activitylogs` | User activity feed |
| `employmentactivities` | Employment update history |
| `embeddingdocuments` | Vector embeddings for the AI assistant's RAG pipeline |
| `importedfiles` | Source files ingested for the AI assistant |
| `aiflags` | Flagged/low-confidence AI assistant answers for admin review |
| `officesettings` | System-wide settings |

> Cascade delete: deleting a user also removes their employment, tracer response, appointments, attendance logs, event feedback, activity logs, and notifications. Changing a user's role away from `alumni` also removes their `graduates` row.

---

## Admin Features

- **Dashboard** — stats overview, employment chart, activity feed (posts + employment, filterable by time window), announcements
- **Alumni Employment** — searchable/filterable table, export CSV, tracer form editor, tracer analytics & survey stats
- **Appointments** — booking management, staff assignment, schedule settings
- **Manage Accounts** — create/edit/delete users, bulk import via Excel, role filter, bulk status updates
- **Announcements** — inline quick post, full composer modal (image, emoji, location), like/comment/share
- **Partnerships** — employer partner management, email-locked employer signup invites
- **AI Assistant** — RAG chatbot over alumni/tracer data, source document ingestion, flagged-answer review
- **About** — alumni association info

## Coordinator Features

- **Dashboard** — event stats, alumni activity, employment summary
- **Event Management** — create/edit/delete events, capacity management
- **Event Participation** — attendance tracking, QR/manual check-in, feedback summaries
- **Employment Details** — scoped employment view (by college) with export
- **Alumni Contacts** — searchable alumni directory

## Alumni Features

- **Onboarding** — first-login password change
- **Tracer Study Form** — dynamic form (questions configurable by admin)
- **Dashboard** — personal alumni portal with home summary
- **Job Connect** — job search, partner postings, saved jobs, job alerts, application tracker
- **Career Recommendations** — AI-driven career fit suggestions and next-step guidance
- **Resume Builder** — build or upload a resume for job applications
- **Suggested Alumni** — networking suggestions with direct messaging
- **Alumni Office** — appointment booking, inquiries

## Employer Features

- **Dashboard** — partnership status overview
- **Job Postings** — post/edit/close job listings
- **Applicants** — review applicants, update status, view resumes, message candidates
- **Interviews** — schedule/update/cancel interviews
- **Appointments** — book time with the alumni office

---

## Environment Variables

### Backend (`.env`)
```
MONGODB_URI=
JWT_SECRET=
JWT_EXPIRES_IN=
EMAIL_USER=
EMAIL_PASS=
FRONTEND_URL=
CLIENT_URL=
HF_API_KEY=
HF_PROVIDER=
HF_CHAT_MODEL=
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
