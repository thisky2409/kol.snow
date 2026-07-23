# KOL Manager

A plain HTML/CSS/JavaScript application for KOL outreach, campaign selection and delivery management. Supabase provides authentication, shared data and role-based access control. The frontend can be hosted directly on GitHub Pages without a build step.

## Roles

- **Marketing**: views assigned campaigns, browses rate-ready KOL accounts, creates shortlists and selects platform accounts for campaigns.
- **Booking**: manages KOL Outreach, contacts, status, PIC and platform-specific rates; also manages contracts and payments.
- **Admin**: full access, including users and workspace settings.

Sensitive outreach/contact data is stored separately and protected by Supabase Row Level Security. Marketing users cannot query it directly.

## Quick start

1. Create a Supabase project.
2. Open **SQL Editor** and run [`supabase/schema.sql`](./supabase/schema.sql).
3. In **Authentication → Users**, create the first user.
4. In SQL Editor, promote that user:

   ```sql
   update public.profiles
   set role = 'Admin', market = 'Global'
   where email = 'your-email@company.com';
   ```

5. Copy the values from `js/config.example.js` into `js/config.js`.
6. Set `demoMode: false`, then enter the Supabase Project URL and anonymous key.
7. Push the folder contents to the `main` branch of a GitHub repository.
8. In **GitHub → Settings → Pages**, choose **GitHub Actions** as the source.

The included workflow publishes the site automatically.

## Local preview

This project has no build step. Serve it through any static server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Opening `index.html` directly with `file://` is not recommended because browser security rules may block authentication callbacks.

## Demo mode

The repository ships with `demoMode: true` so the interface works immediately. Demo records are stored in the browser and a role selector appears in the top bar. Before production use, set `demoMode: false` in `js/config.js`.

## Production checklist

- Add the GitHub Pages URL to **Supabase → Authentication → URL Configuration**.
- Set that URL as **Site URL** and add it to **Redirect URLs**.
- Disable public sign-ups if accounts should be provisioned only by Admin.
- Create team users in Supabase Authentication, then assign role and market in `profiles`.
- Import existing Google Sheets data using [`MIGRATION.md`](./MIGRATION.md).
- Test one account for each role before inviting the team.

## Data rule used by KOL Database

A creator appears in KOL Database when at least one active platform account has `starting_fee > 0`. Only the platform accounts with a fee above zero are shown and selectable. The creator's outreach status does not block the account from appearing.

Default sorting is:

1. Starting fee, low to high.
2. Followers, high to low.
3. Engagement rate, high to low.

## Security note

The Supabase anonymous key is safe to use in browser code when Row Level Security is enabled. Never place a Supabase `service_role` key in this repository or any frontend file.
