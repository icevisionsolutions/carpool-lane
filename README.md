# The Carpool Lane

A shared carpool calendar for a small group of families. Everyone with the
link (and the shared password) sees the same month, and can sign up to drive
pickup, dropoff, or both — for a single day or every week.

This guide gets it live on a free URL with **no domain purchase**. Everything
is done by clicking in a browser — no terminal required.

You'll use three free services:

- **GitHub** — holds the code (you already have an account)
- **Supabase** — the shared database, so all families see the same calendar
- **Vercel** — hosts the site and gives you a free `something.vercel.app` link

Total time: about 20–30 minutes. Do the steps in order.

---

## Step 1 — Set up Supabase (the shared data)

1. Go to **https://supabase.com** and sign in (you can use your GitHub account).
2. Click **New project**. Give it a name like `carpool`, pick any region close
   to you, and set a database password (save it somewhere; you won't need it
   for this app, but Supabase wants one). Click **Create new project** and wait
   ~2 minutes for it to finish setting up.
3. In the left sidebar, open the **SQL Editor**. Click **New query**.
4. Open the file **`supabase-setup.sql`** from this project, copy everything in
   it, paste it into the query box, and click **Run**. You should see a success
   message. This creates the calendar table and its permissions.
5. In the left sidebar, go to **Project Settings** (gear icon) → **API**.
   Copy these two values and keep them handy for Step 3:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

You're done with Supabase.

---

## Step 2 — Put the code on GitHub

1. Go to **https://github.com/new** to create a new repository.
2. Name it `carpool-lane` (or anything). Leave it **Public** or **Private** —
   either works. Don't add a README (this project already has one). Click
   **Create repository**.
3. On the next page, click the link **"uploading an existing file"**
   (in the "…or upload an existing file" line).
4. Drag in **all the files and folders** from this project:
   `index.html`, `package.json`, `vite.config.js`, `README.md`,
   `supabase-setup.sql`, `.gitignore`, and the **`src`** folder
   (with its files inside). 
   - Tip: it's easiest to drag the whole set at once. Make sure the `src`
     folder keeps its files inside it.
5. Scroll down and click **Commit changes**.

Your code is now on GitHub.

---

## Step 3 — Deploy on Vercel (the live link)

1. Go to **https://vercel.com** and click **Sign up** / **Log in**, choosing
   **Continue with GitHub**. Authorize it.
2. Click **Add New… → Project**.
3. Find your `carpool-lane` repo in the list and click **Import**.
4. Vercel auto-detects it's a Vite app — you don't need to change the build
   settings. Before deploying, expand **Environment Variables** and add these
   two (from Step 1.5):

   | Name                     | Value                                   |
   |--------------------------|-----------------------------------------|
   | `VITE_SUPABASE_URL`      | your Supabase **Project URL**           |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase **anon public** key       |

   Type the name on the left, paste the value on the right, click **Add** for
   each one.
5. Click **Deploy** and wait ~1 minute.
6. When it finishes, you'll get a link like **`carpool-lane.vercel.app`**.
   That's your app. Share it with your families.

---

## The password

The app asks for a shared password before showing the calendar. The default is:

    carpool2026

**To change it:** open `src/CarpoolApp.jsx`, find the line near the top:

    const SHARED_PASSWORD = "carpool2026";

Change it to whatever you like, commit the change on GitHub (edit the file
right in the browser — pencil icon → edit → Commit changes), and Vercel will
automatically redeploy with the new password within a minute.

> Note: this password keeps casual strangers out, but it's a light lock, not
> bank-grade security. It's stored in the site's code. For 5 trusted families
> that's the right amount of protection. Don't use it for anything sensitive.

---

## Making changes later

Any time you edit a file on GitHub and commit it, Vercel redeploys
automatically — the live link updates on its own in about a minute. You never
have to touch Vercel again after the first deploy.

## If something looks off

- **"Can't reach the server"** in the top-right of the app → the Supabase
  environment variables in Vercel are missing or mistyped. Recheck Step 3.4
  (Vercel → your project → Settings → Environment Variables), fix them, then
  redeploy (Deployments tab → ⋯ → Redeploy).
- **Password won't accept** → make sure you're typing the exact value of
  `SHARED_PASSWORD`, capitalization included.
- **Calendar is empty for everyone** → that's normal at the start. Add a family
  and a day; it should appear for others within a few seconds.
