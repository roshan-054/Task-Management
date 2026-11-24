# TaskFlow

A team task manager with roles, live completion alerts and KPI profiles. It is a plain static site (HTML, CSS and JavaScript with no build step), so it runs on GitHub Pages, Netlify, Vercel, Cloudflare Pages or any web server.

## What it does

| Area | Details |
|---|---|
| **Roles** | **Admin** manages everyone, departments and teams. **Manager** assigns tasks to anyone in any team and adds members to their department. **Member** works on assigned tasks and can add personal tasks. |
| **Login** | Email and password. Only people an admin or manager has added can create an account, and each person only sees their own data. |
| **Tasks** | Title, details, assignee, priority (Urgent, High, Medium, Low), due date, work status (Not started, In progress, On hold, Completed) and any number of related links shown as clickable chips. |
| **Assigned tasks are locked** | When a manager assigns a task, the assignee can only change its work status. The database enforces this, not just the screen. |
| **Manager view** | "Assigned by Me" lists only the tasks that manager created. Managers do not see other managers' tasks. |
| **Live alerts** | The assigning manager gets an instant in-app alert (and an optional desktop notification) when a task is completed or put on hold. Assignees are alerted when a task is assigned to them. |
| **KPI profiles** | Every person has a profile with a score, completion rate, on-time delivery, average time to complete, overdue count, status breakdown and weekly completions. Members see their own. Managers see everyone in their department; admins see everyone. |

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
   - Under **Authentication → Providers → Email** you can leave **Confirm email** on (recommended) or turn it off so people can sign in straight after activating.
4. **Connect the app.** Open **Project Settings → API**, copy the **Project URL** and the **anon public** key, and paste them into [`js/config.js`](js/config.js):

   ```js
   export const CONFIG = {
     SUPABASE_URL: 'https://abcdefgh.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...',
     APP_NAME: 'TaskFlow',
   };
   ```

   The anon key is designed to be public. What each user can read or change is decided by the security rules in the database, never by this key. **Never** put the `service_role` key in this file.
5. **Create the first admin.** Open the app, choose **Activate your account**, and sign up. The very first account in an empty project automatically becomes the **admin**.
6. **Build your organisation.** As admin, go to **People & Teams**: add departments and teams, then **Add person** for each manager and member. Each person opens the app, chooses **Activate your account** and signs up with the email you added. Use **Copy invite** to get a ready-to-send message.

## Deploy to GitHub Pages

1. Create a new repository on GitHub and push this folder to the `main` branch:

   ```bash
   git init && git add . && git commit -m "TaskFlow"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

2. In the repository open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) publishes the site on every push to `main`. After the first run your app is at `https://roshan-054.github.io/Task-Management/`.
4. Make sure that URL is in Supabase's **Site URL / Redirect URLs** (step 3 above).

Alternative without Actions: **Settings → Pages → Deploy from a branch → main / (root)**. The `.nojekyll` file is already included.

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
.github/workflows/deploy.yml  GitHub Pages deployment
```

## Permission rules (enforced in the database)

- Everyone signed in can see the people directory, so managers can assign across teams.
- You see a task only if it is assigned to you or you created it. Admins see all tasks.
- Members can only create tasks for themselves. Managers and admins can assign to anyone.
- If someone else created a task assigned to you, you can change **only** its status. Any other edit is rejected by the database.
- Only the creator (or an admin) can delete a task.
- Only admins can change someone's role, department, team or deactivate them. Everyone can edit their own name and title.
- Managers can add members only to their own department. Admins can add anyone with any role.
- KPI numbers for other people come from a database function that returns totals only, so managers see department performance without seeing tasks they did not assign.
- Deactivated users cannot sign in to the app or access data.

## FAQ

**Someone gets "This email has not been invited" when activating.** Add them under People & Teams first, with exactly that email.

**Can I remove someone?** Deactivate them in People & Teams (admin). To delete the login entirely, use Supabase **Authentication → Users**.

**Desktop notifications?** Click the bell and choose **Enable desktop alerts**. Alerts appear when the TaskFlow tab is in the background; the tab must be open (in any window) to receive them.
