# Order Pulse — Setup & Admin Guide

Order Pulse is a live IPO grey-market trading desk. It has two parts:

- **User app** (`index.html`): login/sign-up in English or Hindi, share list, trade screen, and My Transactions.
- **Admin panel** (`admin.html`): live offers, the shares editor, users, who's online, the ledger, daily reports and the activity log.

Everything runs on free services:

| Part | Service | Cost |
|---|---|---|
| Database, login, live updates, online tracking, nightly jobs | Supabase (Free plan) | ₹0 |
| Website link | GitHub Pages (or Netlify / Cloudflare Pages) | ₹0 |

---

## Try it first (no setup)

Unzip the folder and **double-click `index.html`**. The app opens in your browser in **demo mode**. In demo mode the data lives only in that browser. Open `admin.html` in a second tab of the same browser to see live updates between the two.

- Demo user: `user@demo.com` / `user123`
- Demo admin: `admin@demo.com` / `admin123`

---

## Go live: one-time setup (about 15 minutes)

### Step 1: Create the database (Supabase)
1. Go to **supabase.com**, click **Start your project**, and sign up free (signing in with GitHub is easiest).
2. Click **New project**:
   - Name: `orderpulse`.
   - Set a strong database password and save it somewhere.
   - Region: **Mumbai (ap-south-1)**.
   - Plan: **Free**.
3. Wait about 2 minutes for the project to be created.

### Step 2: Install the tables
1. Open `supabase/01_setup.sql` in any text editor.
2. Near the bottom (section 12), replace `YOUR_ADMIN_EMAIL@example.com` with **your own email**.
3. In Supabase, go to **SQL Editor** → **New query**. Paste the whole file and click **Run**. It should say "Success".
4. Open a new query, paste `supabase/02_schedules.sql`, and click **Run**.
   - This sets up automatic order expiry and the nightly report.
   - If it complains about `pg_cron`, go to **Database → Extensions**, enable `pg_cron`, then run it again.

### Step 3: Login settings
Go to **Authentication → Sign In / Providers → Email**:
- Turn **OFF** "Confirm email".
- The free plan can send only a few emails per hour, and you approve every user by hand anyway.
- If you'd rather keep email confirmation, leave it on; the app handles both.

Then go to **Authentication → URL Configuration**:
- Set **Site URL** to your app link from Step 5.
- This makes "Forgot password" links open your app.

### Step 4: Connect the app to your database
1. In Supabase, go to **Project Settings → API**. Copy two things:
   - **Project URL**, for example `https://abcdxyz.supabase.co`.
   - **anon public** key. Newer projects call this the **Publishable key**; either one works.
2. Open `js/config.js` and paste them in place of the `PASTE_…` text.

The anon/publishable key is designed to be public. Your data is protected by the database security rules in `01_setup.sql`.

### Step 5: Put it online (GitHub Pages)
1. Sign up free at **github.com**.
2. Click **+ → New repository**:
   - Name: `orderpulse`.
   - Visibility: **Public**.
   - Click **Create**.
3. Click **uploading an existing file**. Drag in **everything inside the `orderpulse` folder** (all files and the `css`, `js` and `supabase` folders), then click **Commit changes**.
4. Go to **Settings → Pages**:
   - Source: **Deploy from a branch**.
   - Branch: **main**, folder **/ (root)**.
   - Click **Save**.
5. After about a minute your app is live:
   - **User app:** `https://YOUR-GITHUB-NAME.github.io/orderpulse/`
   - **Admin panel:** `https://YOUR-GITHUB-NAME.github.io/orderpulse/admin.html`

> Even quicker alternative: **app.netlify.com/drop**. Drag the `orderpulse` folder onto the page, and you get a free link instantly. Create a free account so the link stays permanent.

### Step 6: Become the admin
Open the user app and **Sign up** with the email you put in Step 2. You are automatically approved as administrator. Then open `admin.html` and log in with the same email and password.

Users can install the app on their phone: Chrome menu → **Add to Home screen**, or Safari → Share → **Add to Home Screen**.

---

## Daily use (admin)

| What you want | Where |
|---|---|
| Answer offers | **Live desk**. New offers arrive with a sound and a pop-up. You have three choices: **Accept**, **Counter** (type the new price), or **Reject** (with an optional note). |
| Change GMP, prices, dates, lot sizes | **Shares (edit)**. Edit a cell and click **Save**; users see it instantly. |
| Add or hide a share | **Shares (edit)** → **＋ Add share**. Untick **Show** to hide a share, or untick **Trade** to stop new offers on it. |
| Approve or block users | **Live desk** (new sign-ups) or **Users** → **Allow** / **Block**. |
| See who is online right now | **Online now**, or the panel on the Live desk. It also shows which page each person is on. |
| One user's full history | **Users** → **History →**, which has CSV downloads. |
| All trades with timestamps | **All orders** and **Ledger**, both with filters and CSV. |
| Daily summary | **Daily reports**. Built automatically at 00:05 IST for the previous day; **Build today so far** gives you one any time. |
| Who changed what | **Activity log**. This includes edits made directly in Supabase. |
| Pause all trading, set the response time limit, post an announcement | **Settings** |
| Desktop pop-ups when the tab is in the background | Click **🔔 Alerts** at the top of the admin panel once. |

**How the rules work:**
- **Counter offer** changes that share's price **for everyone**. Orders already accepted keep their price. The user sees "Price updated" and places a revised offer at the new price.
- **Reject** sends the user back to the share list.
- **Unanswered offers** expire after the time limit in Settings (default 120 seconds). Set it to 0 to disable expiry.
- **Ledger:**
  - User BUY: shares are credited and ₹ is debited.
  - User SELL: shares are debited and ₹ is credited.
  - "Balance" is the running ₹ balance for that user.
- **Expected profit** is calculated automatically:
  - Retail: GMP × lot size × retail lots (default 1).
  - HNI: GMP × lot size × HNI lots (you set this per share).

### Editing data directly in Supabase
Go to Supabase → **Table Editor**. It works like a spreadsheet, and every change shows up in the app instantly.

| Table | What it holds |
|---|---|
| `shares` | The share list users see |
| `profiles` | Users. `status` = pending / approved / blocked; `role` = user / admin |
| `app_settings` | Trading on/off, time limit, announcement |
| `orders`, `ledger` | Trading history. Better to view, not edit. |
| `audit_log`, `daily_reports` | Logs and reports |
| `admin_emails` | Emails that become admin when they sign up |

To add another admin, add their email to `admin_emails` before they sign up. If they have already signed up, set their row in `profiles` to role `admin` and status `approved` instead.

---

## Changing the app later

The code is plain HTML, CSS and JavaScript, with no build step. Edit a file, upload it to GitHub again, and the site updates in about a minute.

| To change… | Edit |
|---|---|
| Any wording, in English or Hindi | `js/i18n.js` |
| Colours, fonts, layout | `css/style.css` (colours are at the top) |
| User screens | `js/app.js` |
| Admin screens | `js/admin.js` |
| Database tables and rules | `supabase/01_setup.sql`. It is safe to re-run; it doesn't delete data. |
| Supabase keys | `js/config.js` |

**Example: adding a new column to the share list** (say "Subscription ×"):
1. In Supabase SQL Editor, run: `alter table shares add column subscription numeric;`
2. In `js/admin.js`, add a line to the `SF` list: `{ k: 'subscription', label: 'Subscription ×', type: 'number' },`
3. In `js/app.js`, add a matching `<th>` and `<td>` in the share table.

**Telegram alerts (future):** the table `admin_secrets` and a disabled section in Settings are already in place for it.

---

## Free-plan limits worth knowing
- **Paused project:** Supabase pauses a free project after **7 days with no activity**. Open the Supabase dashboard and click **Restore**. Normal daily use prevents this.
- **Capacity:** the free plan allows about **200 people online at the same time** and 500 MB of data, which is plenty for this app.
- **Login emails** (password reset, confirmations) are limited to a few per hour on the free plan.
- **Forgotten password:** you can set a new password for any user in Supabase → Authentication → Users.

## Security notes
- **Security rules:** every table has them. Users see only their own orders and ledger. Only approved users see shares. Only admins can respond to orders, edit shares, or see other users.
- **Prices:** the price of an order is always taken from the database, never from the user's screen. If the price changed a moment earlier, the user is asked to check the new price.
- **Login page check:** the login page checks whether an email is registered so it can offer sign-up. This means anyone can check whether an email has an account. That's the behaviour you asked for, but worth knowing.
- **Online list:** while signed in, a technically skilled user could see the emails of other people currently online. Ordinary use never shows this.
- **Grey-market trading** is not regulated by SEBI. Keep that in mind for how you describe the service to users.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Wrong email or password" right after sign-up | "Confirm email" is still on (Step 3). Confirm through the email, or turn it off. |
| Website shows a 404 / "There isn't a GitHub Pages site here" | Wait 1–2 minutes after saving Pages settings. Make sure `index.html` sits at the **top level** of the repository (not inside an `orderpulse` sub-folder) and that you uploaded the unzipped files, not the .zip itself. |
| Page shows "Order Pulse could not start" | The message names the problem. Usually the `css` or `js` folder wasn't uploaded, or `js/config.js` has a typo (keep the quotes around both values). |
| The app still says *Demo mode* | `js/config.js` still has the `PASTE_` values, or the updated file wasn't uploaded to GitHub. |
| Changes don't appear live | Re-run `01_setup.sql`; section 8 turns on the live feed. |
| Admin panel says "Administrators only" | Your email isn't in `admin_emails`. Re-run section 12 with your email. |
