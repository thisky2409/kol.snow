# Google Sheets → Supabase migration

The Apps Script version used one row per platform account. The Supabase version keeps the same business structure but separates non-sensitive creator data, platform accounts and private outreach details.

## Recommended order

1. Export `USERS`, `CREATORS`, `ACCOUNTS`, `CAMPAIGNS`, `SHORTLISTS`, `SHORTLIST_KOLS`, `CAMPAIGN_KOLS`, `DELIVERABLES`, `CONTRACTS` and `PAYMENTS` as CSV.
2. Create Auth users in Supabase first. The trigger creates a `profiles` row automatically.
3. Import creators.
4. Import outreach/contact fields into `outreach_profiles`.
5. Import accounts using the new creator UUIDs.
6. Import campaigns, shortlists and campaign KOL records last because they depend on earlier IDs.

## Column mapping

| Google Sheet | Supabase table | Notes |
|---|---|---|
| `USERS` | `profiles` | Auth user UUID must be used as `profiles.id`. |
| `CREATORS` | `creators` | `Categories` and `Languages` become PostgreSQL arrays. |
| Creator contact/source columns | `outreach_profiles` | Private table; only Admin/Booking can access. |
| `ACCOUNTS` | `accounts` | One row per platform; fee and followers remain platform-specific. |
| `CAMPAIGNS` | `campaigns` | `Platforms` and `Assigned_Marketing` become arrays. |
| `SHORTLISTS` | `shortlists` | Same record model. |
| `SHORTLIST_KOLS` | `shortlist_accounts` | Link by the new shortlist/account UUIDs. |
| `CAMPAIGN_KOLS` | `campaign_kols` | Link by new campaign/account/creator UUIDs. |
| `DELIVERABLES` | `deliverables` | Same delivery tracking model. |
| `CONTRACTS` | `contracts` | Hidden from Marketing by RLS. |
| `PAYMENTS` | `payments` | Hidden from Marketing by RLS. |

## Important transformations

- Convert comma-separated `Categories`, `Languages`, `Platforms`, `App_Fit` and `Assigned_Marketing` into PostgreSQL arrays, e.g. `{Beauty,Lifestyle}`.
- Convert blank numeric fields to `0`, not an empty string.
- Convert `TRUE/FALSE` text to booleans.
- Keep a temporary mapping table from every old Apps Script ID to its new Supabase UUID before importing relationship tables.
- Do not import creator contact fields into `creators`; keep them in `outreach_profiles`.

For a large dataset, use a one-time migration script with the Supabase service role key locally. Never commit that key.
