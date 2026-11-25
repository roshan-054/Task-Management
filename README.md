# TaskFlow

A team task manager with roles, live completion alerts and KPI profiles. It is a plain static site (HTML, CSS and JavaScript with no build step), so it runs on GitHub Pages, Netlify, Vercel, Cloudflare Pages or any web server.

## What it does

| Area | Details |
|---|---|
| **Roles** | **Admin** manages everyone, departments and teams. **Manager** assigns tasks to anyone in any team and adds team members to their department. **Team member** works on assigned tasks and can add personal tasks. |
| **Adding people** | Admins and managers add a person and can activate their account on the spot with a temporary password (copied for you to share), or let them activate it themselves. |
| **Login** | Email and password. Only people an admin or manager has added can create an account, and each person only sees their own data. |
| **Tasks** | Title, details, assignee, priority (Urgent, High, Medium, Low), due date, work status (Not started, In progress, On hold, Completed) and any number of related links shown as clickable chips. |
| **Assigned tasks are locked** | When a manager assigns a task, the assignee can only change its work status. The database enforces this, not just the screen. |
| **Manager view** | "Assigned by Me" lists only the tasks that manager created. Managers do not see other managers' tasks. |
| **Live alerts** | The assigning manager gets an instant in-app alert (and an optional desktop notification) when a task is completed or put on hold. Assignees are alerted when a task is assigned to them. |
| **Board & cards** | Tasks show as a drag-and-drop board (one column per status) or as cards. Every card shows priority, due date, links, **Assigned by** and **Assigned to**. |
| **Completion time & history** | The exact date and time a task is started and completed is recorded automatically, and every status change is logged in `task_events` (who, from, to, when) for future analytics. |
| **Remarks & blockers** | Anyone on a task can add remarks. A remark can **flag the task as blocked** with a reason (issue, delay by someone, depends on someone) and **tag people**, optionally with their manager. Tagged people get a live alert, see the task under **Waiting on Me**, can reply and **mark the blocker resolved**, but cannot edit the task. Cards show a red "Blocked · waiting on …" banner until it's resolved. |
| **KPI profiles** | Every person has a profile with a score, completion rate, on-time delivery, average time to complete, overdue count, status breakdown and weekly completions. Team members see **My Performance**. Managers and admins see **Team Performance**: the combined figures for their department (admins: everyone) plus each person's profile. |

**KPI score** = 40% completion rate + 40% on-time delivery + 20% open tasks not overdue. Change the weights in `js/kpi.js`.

## Try it now (demo mode)

With no database configured the app runs in **demo mode**: sample data is stored in your browser only.

```bash
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

Click any demo account on the sign-in screen (password `demo123`). To see live alerts, open a second tab, sign in as **Manager · Ops** in one and **Member · Ops** (Arjun) in the other, then mark one of Arjun's tasks as Completed.

> Opening `index.html` directly from disk will not work because browsers block ES modules on `file://`. Use any local server.

## Why Supabase rather than Google Sheets

| Need | Google Sheets | Supabase (free tier) |
|---|---|---|
| Secure individual logins | No real auth; anyone with the sheet link sees everything | Built-in email and password auth |
| "Assignee can only change status" and "managers see only their own tasks" | Cannot be enforced; sheet permissions are all or nothing | Enforced in the database with row-level security |
| Realtime alerts | Polling only, with API quota limits | Built-in realtime subscriptions |
| Moving later | Proprietary format | Standard PostgreSQL; export with `pg_dump` |

The free tier covers 50,000 monthly active users and 500 MB of database, far more than a team needs. One caveat: free projects pause after 7 days with no activity, and you resume them with one click in the dashboard (any normal weekly use keeps it awake).

## Set up the real database (about 10 minutes)

1. **Create a project** at [supabase.com](https://supabase.com) (free). Pick a region close to your team and save the database password somewhere safe.
2. **Create the tables and rules.** In the Supabase dashboard open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. It is safe to run again after updates.
3. **Auth settings.** Go to **Authentication → URL Configuration** and set **Site URL** to where the app will live, for example `https://roshan-054.github.io/Task-Management/`. Add the same URL (and `http://localhost:8000` for testing) under **Redirect URLs**.
   - Under **Authentication → Sign In / Providers → Email**, keep **Confirm email** ON. This stops someone from claiming an invited email they don't own.
   - Keep **Allow anonymous sign-ins** OFF and leave all other providers (Google, GitHub, phone…) disabled.
4. **Connect the app.** Open **Project Settings → API**, copy the **Project URL** and the **anon public** key, and paste them into [`js/config.js`](js/config.js):

   ```js
   export const CONFIG = {
     SUPABASE_URL: 'https://abcdefgh.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...',
     APP_NAME: 'TaskFlow',
   };
   ```

   The anon key is designed to be public. What each user can read or change is decided by the security rules in the database, never by this key. **Never** put the `service_role` key in this file.
5. **Create the first admin.** Open [`supabase/make-admin.sql`](supabase/make-admin.sql), replace `you@example.com` with your email, paste it into **SQL Editor** and press **Run**. Then open the app, choose **Activate your account** and sign up with that email. No one else can become admin.
6. **Build your organisation.** As admin, go to **People & Teams**: add departments and teams, then **Add person** for each manager and member. Each person opens the app, chooses **Activate your account** and signs up with the email you added. Use **Copy invite** to get a ready-to-send message.

## Updating an existing database

When a new version adds database changes, run the matching file in `supabase/migrations/` in **SQL Editor** (or simply re-run the whole `supabase/schema.sql`; it is safe to run again).

| File | Adds |
|---|---|
| `002_task_history.sql` | `tasks.started_at`, the `task_events` status history table, and backfills existing tasks |
| `003_task_remarks.sql` | `task_remarks` (remarks, blockers, tagged people), notifications for them, and read access for tagged people |

**Activating people from the panel with "Confirm email" on:** Supabase still sends them a confirmation email, and they must click it before their first sign-in. Supabase's built-in email service only sends a few emails per hour; if you add many people at once, set up custom SMTP under **Authentication → Emails**, or turn **Confirm email** off and use **Activate account now** when you add each person (so no invitation is left waiting for someone else to claim).

## Deploy to GitHub Pages

1. Create a new repository on GitHub and push this folder to the `main` branch:

   ```bash
   git init && git add . && git commit -m "TaskFlow"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

2. In the repository open **Settings → Pages**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, and save.
3. GitHub publishes the site on every push to `main`. Your app is at `https://<your-username>.github.io/<repo-name>/`.
4. Make sure that URL is in Supabase's **Site URL / Redirect URLs** (step 3 above).

The `.nojekyll` file is already included so GitHub serves the files as they are.

## Moving to another host later

- **Frontend:** it is static files. Drag the folder into Netlify, Vercel or Cloudflare Pages, or copy it to any web server. No build command, publish directory `/`.
- **Database:** Supabase is standard PostgreSQL. Export with `pg_dump` (connection string in **Project Settings → Database**) and restore anywhere, or self-host Supabase.
- **Different backend entirely:** all data access goes through one adapter. `js/data/local-adapter.js` documents the interface and `js/data/supabase-adapter.js` implements it. Write one new adapter (for Firebase, your own API, etc.) and select it in `js/data/index.js`. No UI code changes.

## Project structure

```
index.html                 App shell
css/styles.css             All styling (light and dark themes)
js/config.js               Your Supabase URL and anon key
js/app.js                  Screens, routing and interactions
js/kpi.js                  KPI score formula
js/data/index.js           Chooses the backend
js/data/supabase-adapter.js  Supabase backend
js/data/local-adapter.js   Demo backend (browser storage) and interface reference
supabase/schema.sql        Tables, permission rules, notifications, KPI function
icons/                     App icon, favicon and Apple touch icon
manifest.webmanifest       Lets people install TaskFlow on their phone or desktop
supabase/migrations/       Database updates for existing installs
```

## Security

**About the key in `js/config.js`.** Every app that runs in a browser has to send its database key to the browser, so anyone can see it with "View source". Supabase designs the *publishable / anon* key for exactly this: on its own it grants nothing. All protection comes from the rules in `supabase/schema.sql`, which run inside the database and cannot be bypassed from the browser or by calling the API directly. Signed-out visitors cannot read any table or call any function.

**Never** put the *secret* or *service_role* key in this repository. It bypasses every rule. If it is ever exposed, rotate it in **Project Settings → API Keys**.

**Who can log in.** An account can only be created for an email an admin or manager added in People & Teams. This is checked by a database trigger on every sign-up path (the app, direct API calls, magic links, anonymous sign-in, OAuth), so it cannot be skipped. Each invitation works once. Deactivated people lose access to all data immediately.

## Permission rules (enforced in the database)

- Everyone signed in can see the people directory, so managers can assign across teams.
- You see a task only if it is assigned to you or you created it. Admins see all tasks.
- Members can only create tasks for themselves. Managers and admins can assign to anyone.
- If someone else created a task assigned to you, you can change **only** its status. Any other edit is rejected by the database.
- Only the creator (or an admin) can delete a task.
- Only admins can change someone's role, department, team or deactivate them. Everyone can edit their own name and title.
- Managers can add members only to their own department. Admins can add anyone with any role.
- KPI numbers for other people come from a database function that returns totals only, so managers see department performance without seeing tasks they did not assign.
- Deactivated users cannot read or change any data.

## FAQ

**Someone gets "This email has not been invited" when activating.** Add them under People & Teams first, with exactly that email.

**Someone says their email is "already registered" but they never signed up.** Someone else may have tried to claim that invitation. Because email confirmation is on, they could not get in. Delete the user in **Authentication → Users**, remove and re-add the person in People & Teams, and ask them to activate again.

**Can I remove someone?** Deactivate them in People & Teams (admin). To delete the login entirely, use Supabase **Authentication → Users**.

**Desktop notifications?** Click the bell and choose **Enable desktop alerts**. Alerts appear when the TaskFlow tab is in the background; the tab must be open (in any window) to receive them.
