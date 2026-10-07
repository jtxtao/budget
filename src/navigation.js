import DashboardPage from "./pages/DashboardPage";
import DonationsPage from "./pages/DonationsPage";
import TransactionsPage from "./pages/TransactionsPage";
import ConfigurationPage from "./pages/ConfigurationPage";
import ReportsPage from "./pages/ReportsPage";
import NetWorthPage from "./pages/NetWorthPage";
import RetirementPage from "./pages/RetirementPage";
import SavingsGoalsPage from "./pages/SavingsGoalsPage";
import RewardsPage from "./pages/RewardsPage";

// Single source of truth for both the route table (App.js) and the tab bar
// (AppShell.js). Adding a page means adding one entry here.
//
// A tab is its label and nothing else. There was once a coloured dot beside each
// one, marking which family the tab belonged to the way the tabs of the
// spreadsheet this app replaces are coloured — but five of the eight shared the
// one colour, so the mark distinguished almost nothing and read as decoration
// instead. The active tab's underline is what says where you are.
export const navigation = [
  {
    path: "/plan",
    label: "Configuration",
    Component: ConfigurationPage,
  },
  {
    path: "/",
    label: "Dashboard",
    Component: DashboardPage,
  },
  {
    path: "/transactions",
    label: "Transactions",
    Component: TransactionsPage,
  },
  {
    path: "/reports",
    label: "Reports",
    Component: ReportsPage,
  },
  {
    path: "/donations",
    label: "Donations",
    Component: DonationsPage,
  },
  {
    path: "/net-worth",
    label: "Net worth",
    Component: NetWorthPage,
  },
  {
    path: "/retirement",
    label: "Retirement",
    Component: RetirementPage,
  },
  {
    path: "/savings-goals",
    label: "Savings goals",
    Component: SavingsGoalsPage,
  },
  {
    path: "/rewards",
    label: "Rewards",
    Component: RewardsPage,
  },
];
