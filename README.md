# Budget App

This budget app allows you to keep track of your money.

**Where your books are kept is your choice, and there are two answers.** Sign in
and they live in your account, so they follow you to any device you sign in from.
Decline the account and they stay where you are — a file on your own computer in
the desktop app, this browser's own storage on the web — with nothing sent
anywhere at all. The desktop app enforces that rather than promising it: unless
there is a session to justify one, the process makes no network request of any
kind.

Either way the books are yours to take: **Configuration → Your books as a file**
exports everything as readable JSON and restores it again.

## Getting started

```sh
npm install
npm start        # dev server at http://localhost:3000
npm run desktop  # the desktop app, against that same dev server
```

| Command | What it does |
| --- | --- |
| `npm start` | Development server with hot reload |
| `npm test` | Jest + React Testing Library, watch mode |
| `npm test -- --watchAll=false` | Single non-interactive run |
| `npm run build` | Production build into `build/` |
| `npm run desktop` | Electron shell pointed at the dev server |
| `npm run desktop:build` | Packaged app into `dist/`, without an installer |
| `npm run desktop:dist` | Installer for the platform you are on |

Accounts are optional and off unless configured: copy `.env.example` to
`.env.local` and fill in a Supabase project's URL and anon key. With those unset
the app runs signed out on this machine's own books, which is also how the test
suite runs it. `supabase/schema.sql` is the whole server side — run it once, whole,
in a new project's SQL editor.

You can sign in with a password or have a one-time link emailed to you. The second
is for accounts that have no password at all, which is what signing up through
Google or a magic link elsewhere produces. It needs one setting the schema script
cannot make for you: the project's **Magic Link** email template must include
`{{ .Token }}` alongside `{{ .ConfirmationURL }}`, because the desktop app cannot
open a link and reads the code out of that same email. Editing that template
requires custom SMTP to be configured first — Supabase fixes the templates on its
built-in sender, and the stock one carries only the link. The web app is
unaffected either way. `supabase/schema.sql`'s header lists that and the settings
beside it.

Built with Create React App (react-scripts 5), React 18, React Router 6 and
Tailwind CSS 3, packaged with Electron and electron-builder. Linting is CRA's
built-in ESLint, which runs as part of `npm start` and `npm test` — there is no
separate lint script.

## Current features — V0.2

- Set custom categories [0.1]
- Add and delete expenses [0.1]
- Add and delete incomes [0.2]
- A planned amount per category *per month*, so a limit set in one month carries
  forward until you change it rather than needing to be re-entered
- Deleting a category keeps its expenses, reassigning them to **Uncategorized** —
  what you spent is a matter of record, and only the label was wrong

Everything above lives on the **Transactions** page. The app's other five
sections — Dashboard, Plan, Reports, Net worth and Retirement — are scaffolded:
each renders the list of capabilities it is meant to cover, so the intended scope
is visible before the section is built.

## How the data is kept

Two rules hold everywhere, and are worth knowing before contributing:

- **Money is stored as an integer number of cents**, never as floating-point
  dollars. A ledger that disagrees with itself is worse than no ledger.
- **Transactions carry a plain `YYYY-MM-DD` date** on the local calendar, and the
  month is always derived from it rather than stored next to it, so the two
  cannot drift apart.

Records written by earlier versions are migrated on read, and entries predating
dates are shown as "Undated" rather than backfilled with invented history.

## Coming soon

- Zero based budget method
    - Figure out starting point [0.3]
    - Budgeting new money as it comes in [0.4]
    - Allowing you to move money between categories [0.5]
    - Auto Assign [0.6]
- Saving and importing your information through csv file [0.8]
- Saving your information through signing up [1.0]

## Roadmap

### Near term

- Saving goals
- Starting point / net worth tracking

### Medium Term

- Charts - income vs expenses, starting vs end balance, spending by category
- Transfers
- Resetting per month
- Big goals (retirement, debt, etc.)
- Next paycheck
- Loan calculator

### Long Term

- Beer money
- Donations
- Credit Score tracking
- Investment tracking
- Monthly and Yearly history, spending by category by month etc.
- Tax calculator

Feature research behind this roadmap — what users of comparable budgeting apps
ask for and complain about — is collected in [`docs/feature-research.md`](docs/feature-research.md).

## Contributing

Architecture notes, conventions and the reasoning behind them are in
[`.claude/CLAUDE.md`](.claude/CLAUDE.md).
