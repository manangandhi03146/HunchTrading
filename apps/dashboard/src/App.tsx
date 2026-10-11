import { Home, MarketPage, Portfolio, Help, NotFound } from "./PublicPages";
import { DemoProvider, ExhibitionAccountBadge } from "./demos/DemoProvider";
import { FortniteDemo } from "./demos/FortniteDemo";
import { FundingDemo } from "./demos/FundingDemo";
import { FundsProvider } from "./wallet/FundsProvider";
import { SidebarFunds, WalletFundsPage } from "./wallet/WalletFunds";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import RacingApp from "../../racing/src/App";
import EsportsApp from "../../esports/src/App";
import "../../racing/src/styles.css";
import "../../esports/src/styles.css";
import { appUrl } from "../../shared/links";
import { ThemeSwitch, useTheme, type Theme } from "../../shared/theme";
import { useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  FileCode2,
  Flag,
  Layers3,
  LayoutDashboard,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Logo,
  MarketStatus,
  PredictionMarket,
  Skeleton,
  TransactionLink,
  WalletButton,
  effectiveStatus,
  formatTokens,
  useEvents,
  useMarket,
  useHunch,
  useMarkets,
  useNow,
  type CreateMarketParams,
  type Market,
  type MarketEvent,
} from "@hunch/react";

const NAV = [
  { path: "/", label: "Home", icon: LayoutDashboard },
  { path: "/markets", label: "Markets", icon: Layers3 },
  { path: "/portfolio", label: "My predictions", icon: ShieldCheck },
  { path: "/help", label: "How it works", icon: CircleHelp },
  { path: "/overview", label: "Developer tools", icon: Code2 },
];
function date(seconds: number) {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function ModeNotice() {
  const { mode, client } = useHunch();
  return (
    <div className="mode-notice">
      <span>
        <ShieldCheck size={14} />
        {mode === "mock"
          ? client.shared ? "Shared demo · markets and simulated balances are served by one backend." : "Local demo · markets and simulated balances stay on this device."
          : "Live SDK workspace · Solana Devnet · nonredeemable test tokens."}
      </span>
      <span>
        {mode === "mock" ? "NO BLOCKCHAIN TRANSACTIONS" : "DEVNET ONLY"}
      </span>
    </div>
  );
}
function PageTitle({
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function MarketTable({
  markets,
  compact = false,
}: {
  markets: Market[];
  compact?: boolean;
}) {
  const now = useNow();
  return (
    <div className="market-table-wrap">
      <table className="market-table" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col">Market</th>
            <th scope="col">Status</th>
            <th scope="col">Pool</th>
            {!compact && <th scope="col">Closes</th>}
            {!compact && <th scope="col">Created</th>}
            <th scope="col">
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {markets.map((market) => (
            <tr key={market.id} role="row">
              <td role="cell">
                <Link
                  to={`/markets/${encodeURIComponent(market.id)}`}
                >
                  <span className="market-table-icon">
                    <Flag size={15} />
                  </span>
                  <span>
                    <strong>{market.question}</strong>
                    <small>{market.id}</small>
                  </span>
                </Link>
              </td>
              <td role="cell">
                <MarketStatus status={effectiveStatus(market, now)} />
              </td>
              <td role="cell" data-label="Pool">
                <strong className="tabular">
                  {formatTokens(market.totalPool)}
                </strong>
                <small> HUNCH</small>
              </td>
              {!compact && (
                <td className="table-date" role="cell" data-label="Closes">
                  {date(market.closesAt)}
                </td>
              )}
              {!compact && (
                <td className="table-date" role="cell" data-label="Created">
                  {market.createdAt ? date(market.createdAt) : "Not provided"}
                </td>
              )}
              <td role="cell">
                <Link
                  className="table-open"
                  to={`/markets/${encodeURIComponent(market.id)}`}
                  aria-label={`View ${market.question}`}
                >
                  <ArrowUpRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Overview() {
  const now = useNow();
  const { mode, client } = useHunch();
  const markets = useMarkets();
  const events = useEvents();
  const list = markets.data ?? [];
  const pool = list.reduce((sum, market) => sum + market.totalPool, 0n);
  const applicationPools = new Map<string, bigint>();
  for (const market of list) {
    const application = market.application ?? "Your application";
    applicationPools.set(
      application,
      (applicationPools.get(application) ?? 0n) + market.totalPool,
    );
  }
  const rankedApplications = Array.from(
    applicationPools,
    ([name, totalPool]) => ({ name, totalPool }),
  ).sort((a, b) =>
    a.totalPool === b.totalPool
      ? a.name.localeCompare(b.name)
      : a.totalPool > b.totalPool
        ? -1
        : 1,
  );
  const visibleApplications =
    rankedApplications.length > 5
      ? [
          ...rankedApplications.slice(0, 4),
          {
            name: "Other applications",
            totalPool: rankedApplications
              .slice(4)
              .reduce((sum, item) => sum + item.totalPool, 0n),
          },
        ]
      : rankedApplications;
  const stats = [
    {
      label: "Total markets",
      value: String(list.length),
      detail: "Across your applications",
      icon: Layers3,
    },
    {
      label: "Active markets",
      value: String(
        list.filter((market) => effectiveStatus(market, now) === "open").length,
      ),
      detail: "Accepting predictions",
      icon: Zap,
    },
    {
      label: "Resolved markets",
      value: String(
        list.filter((market) => market.status === "resolved").length,
      ),
      detail: "Outcomes recorded",
      icon: CheckCircle2,
    },
    {
      label: "Total test-token pool",
      value: formatTokens(pool),
      detail: "HUNCH · zero-decimal tokens",
      icon: ArrowDownLeft,
    },
  ];
  return (
    <>
      <PageTitle
        eyebrow="YOUR DEVELOPER WORKSPACE"
        title="Your prediction workspace"
        subtitle="Create markets, follow outcomes, and bring hunch into your product."
        action={
          <Link className="hunch-button hunch-button-primary" to="/markets/new">
            <Plus size={15} />
            Create market
          </Link>
        }
      />
      <ModeNotice />
      {markets.error && (
        <ErrorState
          error={markets.error}
          retry={() => {
            void markets.refetch();
          }}
        />
      )}
      <div className="dashboard-stats">
        {stats.map((stat) => (
          <Card key={stat.label} className="stat-card">
            <div>
              <span>{stat.label}</span>
              <stat.icon size={15} />
            </div>
            <strong>{markets.isPending ? "—" : stat.value}</strong>
            <small>{stat.detail}</small>
          </Card>
        ))}
      </div>
      <div className="overview-columns">
        <Card className="volume-card">
          <div className="panel-heading">
            <div>
              <h2>Where predictions happen</h2>
              <p>Current pool by application</p>
            </div>
            <Badge>{mode === "mock" ? "Sample data" : "Devnet"}</Badge>
          </div>
          <div className="pool-visualization">
            {visibleApplications.map((application, index) => (
              <div key={application.name} className="pool-row">
                <span className="pool-row-icon">
                  <Layers3 size={14} />
                </span>
                <div>
                  <div>
                    <span>{application.name}</span>
                    <strong className="tabular">
                      {formatTokens(application.totalPool)} <small>HUNCH</small>
                    </strong>
                  </div>
                  <span className={`pool-row-track pool-color-${index % 3}`}>
                    <span
                      style={{
                        transform: `scaleX(${pool === 0n ? 0 : Number((application.totalPool * 1000n) / pool) / 1000})`,
                      }}
                    />
                  </span>
                </div>
              </div>
            ))}
            {!markets.isPending && list.length === 0 && (
              <EmptyState title="Your first market starts here">
                <Link
                  className="hunch-button hunch-button-secondary"
                  to="/markets/new"
                >
                  Create a market
                </Link>
              </EmptyState>
            )}
          </div>
          <div className="panel-footnote">
            Pooled stakes, measured in nonredeemable HUNCH tokens.
          </div>
        </Card>
        <Card className="quickstart-card">
          <div className="quickstart-icon">
            <FileCode2 size={24} />
          </div>
          <h2>Embed a prediction.</h2>
          <p>
            Create a market. Copy a component.
            <br />
            Let your community make the call.
          </p>
          <pre>
            <code>
              <span>import</span> {"{ PredictionMarket }"}
              {"\n"}
              <span>from</span> <b>'@hunch/react'</b>;{"\n\n"}
              {"<PredictionMarket"}
              {'\n  marketId="race-42"\n/>'}
            </code>
          </pre>
          <Link to="/integration">
            Explore the quickstart <ArrowRight size={14} />
          </Link>
        </Card>
      </div>
      <Card className="recent-markets">
        <div className="panel-heading">
          <div>
            <h2>Recent markets</h2>
            <p>Your latest integrations, at a glance.</p>
          </div>
          <Link className="panel-link" to="/markets">
            View all markets <ArrowRight size={13} />
          </Link>
        </div>
        {markets.isPending ? (
          <Skeleton />
        ) : list.length > 0 ? (
          <MarketTable markets={list.slice(0, 4)} compact />
        ) : (
          <EmptyState title="No markets yet">
            <Link
              className="hunch-button hunch-button-secondary"
              to="/markets/new"
            >
              Create your first market
            </Link>
          </EmptyState>
        )}
      </Card>
      <div className="activity-section">
        <div className="panel-heading">
          <h2>Latest activity</h2>
          <Link className="panel-link" to="/events">
            Event stream <ArrowRight size={13} />
          </Link>
        </div>
        {events.error ? (
          <ErrorState
            error={events.error}
            retry={() => {
              void events.refetch();
            }}
          />
        ) : events.isPending ? (
          <p className="muted">Loading activity…</p>
        ) : (
          <EventRows events={(events.data ?? []).slice(0, 3)} compact />
        )}
      </div>
    </>
  );
}
function Markets() {
  const { mode, client } = useHunch();
  const now = useNow();
  const query = useMarkets();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const list = (query.data ?? []).filter(
    (market) =>
      (filter === "all" || effectiveStatus(market, now) === filter) &&
      `${market.question} ${market.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="MARKET INFRASTRUCTURE"
        title="Explore markets"
        subtitle="Find a question, make your prediction, and follow the result."
        action={
          <Link className="hunch-button hunch-button-primary" to="/markets/new">
            <Plus size={15} />
            Create market
          </Link>
        }
      />
      <ModeNotice />
      <Card className="markets-panel">
        <div className="table-toolbar">
          <label className="market-search">
            <Search size={15} />
            <input
              aria-label="Search markets"
              placeholder="Search by question or market ID…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label="Filter by market status"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Awaiting result</option>
            <option value="resolved">Resolved</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {query.error ? (
          <ErrorState
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.isPending ? (
          <Skeleton />
        ) : list.length > 0 ? (
          <MarketTable markets={list} />
        ) : (
          <EmptyState
            title={
              query.data?.length ? "No matching markets" : "No markets yet"
            }
          >
            {!query.data?.length ? (
              <Link
                className="hunch-button hunch-button-primary"
                to="/markets/new"
              >
                Create your first market
              </Link>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </EmptyState>
        )}
        <div className="table-footnote">
          {list.length} market{list.length !== 1 ? "s" : ""} ·{" "}
          {mode === "mock" ? client.shared ? "Shared simulation" : "Local simulation" : "Solana Devnet"}
        </div>
      </Card>
    </>
  );
}
function localDatetime(milliseconds: number) {
  const value = new Date(milliseconds);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function CreateMarket() {
  const { client, mode, notify } = useHunch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [outcomeA, setOutcomeA] = useState("");
  const [outcomeB, setOutcomeB] = useState("");
  const [closing, setClosing] = useState(() =>
    localDatetime(Date.now() + 3600000),
  );
  const [description, setDescription] = useState("");
  const [validation, setValidation] = useState<
    Partial<Record<"question" | "outcome-a" | "outcome-b" | "closing", string>>
  >({});
  const create = useMutation({
    mutationFn: async (params: CreateMarketParams) => {
      const result = await client.createMarket(params);
      const transaction = await client.confirmTransaction(result.transaction);
      return { ...result, transaction };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      notify(
        mode === "mock"
          ? "Simulated market created. Open its page to share or predict."
          : "Market creation confirmed on Devnet.",
      );
      navigate(`/markets/${encodeURIComponent(result.market.id)}`, {
        state: { transaction: result.transaction },
      });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const closesAt = Math.floor(new Date(closing).getTime() / 1000);
    const errors: typeof validation = {};
    if (!question.trim())
      errors.question = "Enter the question your community will answer.";
    if (!outcomeA.trim())
      errors["outcome-a"] = "Enter the first possible outcome.";
    if (!outcomeB.trim())
      errors["outcome-b"] = "Enter the second possible outcome.";
    if (
      outcomeA.trim() &&
      outcomeA.trim().toLowerCase() === outcomeB.trim().toLowerCase()
    ) {
      errors["outcome-b"] =
        "Choose a different outcome. Outcome A and B must be distinct.";
    }
    if (!Number.isFinite(closesAt) || closesAt <= Date.now() / 1000) {
      errors.closing =
        "Choose a future date and time, before your event begins.";
    }
    setValidation(errors);
    const firstInvalid = Object.keys(errors)[0];
    if (firstInvalid) {
      event.currentTarget
        .querySelector<HTMLInputElement>(`#${firstInvalid}`)
        ?.focus();
      return;
    }
    create.mutate({
      question: question.trim(),
      outcomes: [outcomeA.trim(), outcomeB.trim()],
      closesAt,
      description: description.trim() || undefined,
    });
  };
  return (
    <>
      <PageTitle
        eyebrow="A NEW POSSIBILITY"
        title="Create a market"
        subtitle="Ask a clear question. Give your community two outcomes."
      />
      <ModeNotice />
      <div className="create-layout">
        <Card className="create-form-card">
          <form onSubmit={submit} noValidate>
            <div className="form-section-title">
              <span>01</span>
              <div>
                <h2>Market details</h2>
                <p>Make the outcome clear and objectively resolvable.</p>
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="question">Market question</label>
              <input
                id="question"
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  setValidation((errors) => ({
                    ...errors,
                    question: undefined,
                  }));
                }}
                aria-invalid={!!validation.question}
                aria-describedby={`question-hint${validation.question ? " question-error" : ""}`}
                maxLength={200}
                required
                placeholder="Who wins the championship final?"
              />
              <small id="question-hint">
                This question appears at the top of your widget.
              </small>
              {validation.question && (
                <p className="form-field-error" id="question-error">
                  {validation.question}
                </p>
              )}
            </div>
            <div className="form-outcomes">
              <div className="form-field">
                <label htmlFor="outcome-a">Outcome A</label>
                <input
                  id="outcome-a"
                  value={outcomeA}
                  onChange={(event) => {
                    setOutcomeA(event.target.value);
                    setValidation((errors) => ({
                      ...errors,
                      "outcome-a": undefined,
                      "outcome-b": undefined,
                    }));
                  }}
                  aria-invalid={!!validation["outcome-a"]}
                  aria-describedby={
                    validation["outcome-a"] ? "outcome-a-error" : undefined
                  }
                  maxLength={60}
                  required
                  placeholder="Team Nova"
                />
                {validation["outcome-a"] && (
                  <p className="form-field-error" id="outcome-a-error">
                    {validation["outcome-a"]}
                  </p>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="outcome-b">Outcome B</label>
                <input
                  id="outcome-b"
                  value={outcomeB}
                  onChange={(event) => {
                    setOutcomeB(event.target.value);
                    setValidation((errors) => ({
                      ...errors,
                      "outcome-b": undefined,
                    }));
                  }}
                  aria-invalid={!!validation["outcome-b"]}
                  aria-describedby={
                    validation["outcome-b"] ? "outcome-b-error" : undefined
                  }
                  maxLength={60}
                  required
                  placeholder="Team Titan"
                />
                {validation["outcome-b"] && (
                  <p className="form-field-error" id="outcome-b-error">
                    {validation["outcome-b"]}
                  </p>
                )}
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="description">
                Description <span className="muted">(optional)</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                placeholder="Add context about the event and resolution criteria."
              />
            </div>
            <div className="form-section-title second">
              <span>02</span>
              <div>
                <h2>Prediction window</h2>
                <p>Predictions must close before your event begins.</p>
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="closing">Closing date and time</label>
              <input
                id="closing"
                type="datetime-local"
                value={closing}
                onChange={(event) => {
                  setClosing(event.target.value);
                  setValidation((errors) => ({
                    ...errors,
                    closing: undefined,
                  }));
                }}
                aria-invalid={!!validation.closing}
                aria-describedby={`closing-hint${validation.closing ? " closing-error" : ""}`}
                min={localDatetime(Date.now() + 60000)}
                required
              />
              <small id="closing-hint">
                Shown in your browser’s local timezone (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}).
              </small>
              {validation.closing && (
                <p className="form-field-error" id="closing-error">
                  {validation.closing}
                </p>
              )}
            </div>
            {create.error && <ErrorState error={create.error} />}
            <div className="form-submit">
              <Link className="hunch-button hunch-button-ghost" to="/markets">
                Cancel
              </Link>
              <Button type="submit" busy={create.isPending}>
                {create.isPending ? (
                  "Creating and confirming…"
                ) : (
                  <>
                    Create market <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
        <aside className="create-guide">
          <span className="guide-icon">
            <ShieldCheck size={24} />
          </span>
          <h3>A few good defaults.</h3>
          <p>
            hunch uses binary pooled predictions with integer HUNCH tokens. No
            order books or fixed payout odds.
          </p>
          <div>
            <Check size={14} />
            <span>Two distinct outcomes</span>
          </div>
          <div>
            <Check size={14} />
            <span>Predictions close before the event</span>
          </div>
          <div>
            <Check size={14} />
            <span>Results from your authorized server</span>
          </div>
          <div>
            <Check size={14} />
            <span>Live mode uses Solana Devnet only</span>
          </div>
          <p className="guide-note">
            {mode === "mock"
              ? "This creates a simulated market. Shared-demo markets can be opened in other browser sessions; browser-local markets stay on this device."
              : "Your wallet signs market creation through the SDK. The authorized resolver submits the result."}
          </p>
        </aside>
      </div>
    </>
  );
}
function Integration() {
  const { theme: appTheme } = useTheme();
  const now = useNow();
  const { client, mode } = useHunch();
  const markets = useMarkets();
  const [params, setParams] = useSearchParams();
  const [widgetTheme, setWidgetTheme] = useState<Theme | "app">("app");
  const theme = widgetTheme === "app" ? appTheme : widgetTheme;
  const [variant, setVariant] = useState<"default" | "compact">("default");
  const marketId =
    params.get("market") ??
    import.meta.env.VITE_HUNCH_MARKET_ID ??
    markets.data?.[0]?.id ??
    "race-42";
  const market = useMarket(marketId);
  const snippet = `import { PredictionMarket } from "@hunch/react";\nimport "@hunch/react/styles.css";\n\n// Inside the HunchProvider configured below:\n<PredictionMarket\n  marketId=${JSON.stringify(marketId)}\n  theme="${theme}"\n  variant="${variant}"\n/>`;
  const providerSnippet =
    mode === "mock"
      ? `import { HunchProvider } from "@hunch/react";\n\n<HunchProvider mode="mock">\n  <App />\n</HunchProvider>`
      : `import { HunchProvider } from "@hunch/react";\n\n// Your reviewed SDK bindings and public Devnet configuration:\n<HunchProvider\n  mode="sdk"\n  programId={programId}\n  tokenMint={tokenMint}\n  sdkBindings={sdkBindings}\n  rpcUrl="https://api.devnet.solana.com"\n>\n  <App />\n</HunchProvider>`;
  return (
    <>
      <PageTitle
        eyebrow="YOUR PRODUCT. OUR INFRASTRUCTURE."
        title="Integrate in minutes"
        subtitle="One React component. A complete prediction experience."
      />
      <ModeNotice />
      <div className="integration-layout">
        <Card className="integration-config">
          <div className="panel-heading">
            <h2>Configure your widget</h2>
            <Badge>React</Badge>
          </div>
          <div className="integration-fields">
            {markets.error && (
              <ErrorState
                error={markets.error}
                retry={() => {
                  void markets.refetch();
                }}
              />
            )}
            <div className="form-field">
              <label htmlFor="market-select">Market</label>
              <select
                id="market-select"
                value={marketId}
                disabled={markets.isPending}
                onChange={(event) => setParams({ market: event.target.value })}
              >
                {markets.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.question}
                  </option>
                ))}
                {!markets.data?.some((item) => item.id === marketId) && (
                  <option value={marketId}>{marketId}</option>
                )}
              </select>
            </div>
            <div className="form-outcomes">
              <div className="form-field">
                <label htmlFor="theme">Widget theme</label>
                <select
                  id="theme"
                  value={widgetTheme}
                  onChange={(event) =>
                    setWidgetTheme(event.target.value as Theme | "app")
                  }
                >
                  <option value="app">Follow app theme</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="variant">Size</label>
                <select
                  id="variant"
                  value={variant}
                  onChange={(event) =>
                    setVariant(event.target.value as "default" | "compact")
                  }
                >
                  <option value="default">Default</option>
                  <option value="compact">Compact</option>
                </select>
              </div>
            </div>
          </div>
        </Card>
        <aside className="integration-preview">
          <div className="preview-heading">
            <h2>Widget preview</h2>
            <Badge>{mode === "mock" ? "Simulated" : "Devnet"}</Badge>
          </div>
          <PredictionMarket
            key={marketId}
            marketId={marketId}
            theme={theme}
            variant={variant}
          />
        </aside>
        <details className="integration-documentation disclosure">
          <summary>
            Embed code and setup guide <Code2 size={17} aria-hidden="true" />
          </summary>
          <Card className="integration-code">
            <div className="code-header">
              <span>
                <FileCode2 size={14} /> YourComponent.tsx
              </span>
              <CopyButton text={snippet} />
            </div>
            <pre>
              <code>{snippet}</code>
            </pre>
          </Card>
          <Card className="setup-card">
            <h2>Before you embed</h2>
            <div className="setup-step">
              <span>1</span>
              <div>
                <h3>Install the workspace packages</h3>
                <pre>
                  <code>
                    {"npm install\nnpm run build --workspace @hunch/react"}
                  </code>
                </pre>
                <p>
                  This hackathon package is available in the monorepo. It has
                  not been published to npm.
                </p>
              </div>
            </div>
            <div className="setup-step">
              <span>2</span>
              <div>
                <h3>Wrap your app once</h3>
                <pre>
                  <code>{providerSnippet}</code>
                </pre>
                <p>
                  The provider shares wallet connection, queries, and client
                  state across widgets.
                </p>
              </div>
            </div>
            <div className="setup-step">
              <span>3</span>
              <div>
                <h3>Connect the live SDK when ready</h3>
                <p>
                  Pass your <code>sdkBindings</code>, the configured{" "}
                  <code>programId</code>, and <code>tokenMint</code> to the
                  provider in SDK mode. Mock mode works without them.
                </p>
              </div>
            </div>
          </Card>
        </details>
        <Card className="network-info integration-details">
          <h3>Integration details</h3>
          <div>
            <span>Market ID</span>
            <code>{marketId}</code>
          </div>
          <div>
            <span>Status</span>
            {market.data && (
              <MarketStatus status={effectiveStatus(market.data, now)} />
            )}
          </div>
          <div>
            <span>Network</span>
            <strong>
              {mode === "mock" ? "Local demo · no RPC" : "Solana Devnet"}
            </strong>
          </div>
          <div>
            <span>Program configuration</span>
            <code>
              {mode === "mock"
                ? "Not used in simulation"
                : (client.programId ?? "Program not configured")}
            </code>
          </div>
          <div>
            <span>Mode</span>
            <strong>{mode === "mock" ? "Local simulation" : "Live SDK"}</strong>
          </div>
        </Card>
      </div>
    </>
  );
}
function EventRows({
  events,
  compact = false,
}: {
  events: MarketEvent[];
  compact?: boolean;
}) {
  const markets = useMarkets();
  if (!events.length)
    return (
      <EmptyState title="No events yet">
        <Link className="hunch-button hunch-button-secondary" to="/markets/new">
          Create a market
        </Link>
      </EmptyState>
    );
  return (
    <div className="event-list">
      {events.map((event) => (
        <div className="event-row" key={event.id}>
          <span
            className={`event-icon ${event.type === "failed" ? "event-icon-error" : ""}`}
          >
            {event.type === "failed" ? (
              <XCircle size={16} />
            ) : event.type === "confirmed" || event.type === "claim" ? (
              <CheckCircle2 size={16} />
            ) : (
              <Activity size={16} />
            )}
          </span>
          <div className="event-content">
            <strong>{event.message.replace(/\bTEST\b/g, "HUNCH")}</strong>
            <Link
              className="event-market"
              to={`/markets/${encodeURIComponent(event.marketId)}`}
            >
              {markets.data?.find((market) => market.id === event.marketId)
                ?.question ?? "View market"}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
            <div className="event-context">
              <EventMarketId id={event.marketId} />
              {!compact && <span> · {event.type.replace(/_/g, " ")}</span>}
            </div>
          </div>
          <div className="event-meta">
            <time dateTime={new Date(event.timestamp * 1000).toISOString()}>
              {date(event.timestamp)}
            </time>
            {event.simulated ? (
              <span>Simulated</span>
            ) : (
              event.signature && (
                <TransactionLink
                  result={{
                    signature: event.signature,
                    status: "submitted",
                    simulated: false,
                  }}
                />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
function EventMarketId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <span className="event-id">
      <abbr title={id}>
        {copyFailed || id.length <= 20
          ? id
          : `${id.slice(0, 8)}…${id.slice(-6)}`}
      </abbr>
      <button
        type="button"
        className="event-id-copy"
        aria-label={`Copy full market ID ${id}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setCopyFailed(false);
          } catch {
            setCopied(false);
            setCopyFailed(true);
          }
        }}
      >
        {copied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy ID"}
      </button>
      <span className="sr-only" role="status">
        {copied
          ? "Market ID copied."
          : copyFailed
            ? "Copy unavailable. The full market ID is shown for manual copying."
            : ""}
      </span>
    </span>
  );
}
function Events() {
  const query = useEvents();
  const [filter, setFilter] = useState("all");
  const events = (query.data ?? []).filter(
    (event) => filter === "all" || event.type === filter,
  );
  return (
    <>
      <PageTitle
        eyebrow="FOLLOW EVERY EVENT"
        title="The event stream"
        subtitle="From game-server result to market resolution, with every step visible."
      />
      <ModeNotice />
      <details className="pipeline-explainer disclosure">
        <summary>
          How settlement works <CircleHelp size={17} aria-hidden="true" />
        </summary>
        <p>
          This is the settlement sequence, not the progress of a specific
          transaction. Check the activity below for actual events and receipts.
        </p>
        <div className="event-pipeline">
          {[
            { icon: RadioIcon, label: "Event received" },
            { icon: ShieldCheck, label: "Signature verified" },
            { icon: Terminal, label: "Resolution submitted" },
            { icon: CheckCircle2, label: "Transaction confirmed" },
          ].map((step, index) => (
            <div key={step.label}>
              <step.icon size={18} />
              <span>{step.label}</span>
              {index < 3 && <ChevronRight size={13} />}
            </div>
          ))}
        </div>
      </details>
      <Card className="events-panel">
        <div className="panel-heading">
          <h2>Recent activity</h2>
          <select
            aria-label="Filter event type"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All events</option>
            <option value="created">Market creation</option>
            <option value="event_received">Event received</option>
            <option value="signature_verified">Signature verified</option>
            <option value="resolution_submitted">Resolution submitted</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
            <option value="prediction">Predictions</option>
            <option value="claim">Claims</option>
          </select>
        </div>
        {query.error ? (
          <ErrorState
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.isPending ? (
          <Skeleton />
        ) : events.length === 0 && filter !== "all" ? (
          <EmptyState title="No events of this type yet">
            <Button variant="secondary" onClick={() => setFilter("all")}>
              Show all events
            </Button>
          </EmptyState>
        ) : (
          <EventRows events={events} />
        )}
      </Card>
    </>
  );
}
function RadioIcon(props: { size?: number }) {
  return <Activity {...props} />;
}
export default function App() {
  const { pathname } = useLocation();
  const { mode, client } = useHunch();
  const exhibition = ["/fortnite", "/funding"].includes(pathname);
  const fundsPage = pathname === "/wallet";
  return (
    <FundsProvider><DemoProvider><div className="dashboard-app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="dashboard-sidebar">
        <Link to="/" className="sidebar-logo">
          <Logo />
        </Link>
        <SidebarFunds />
        <div className="workspace-switch">
          <span className="workspace-avatar">h</span>
          <div>
            <strong>hunch community</strong>
            <small>
              {mode === "mock" ? "Demo environment" : "Devnet environment"}
            </small>
          </div>
          <Badge>DEV</Badge>
        </div>
        <span className="sidebar-section-label">WORKSPACE</span>
        <nav aria-label="Hunch navigation">
          {NAV.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                isActive ? "sidebar-nav-link active" : "sidebar-nav-link"
              }
            >
              <item.icon size={17} />
              {item.label}
              {item.path === "/events" && <span className="sidebar-live-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-examples"><span className="sidebar-section-label demos-label">
          EXAMPLE APPLICATIONS
        </span>
        <NavLink to="/fortnite" className={({ isActive }) => `sidebar-nav-link sidebar-livestream ${isActive ? "active" : ""}`}><RadioIcon size={17} /><span><strong>Livestream demo</strong><small>SypherPK · Fortnite</small></span></NavLink>
        <NavLink to="/funding" className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}><ArrowDownLeft size={17} />Funding model</NavLink>
        <a
          className="sidebar-nav-link sidebar-demo-link"
          href={appUrl("racing")}
          aria-label="Racing demo"
        >
          <Flag size={17} />
          Racing<span className="sidebar-demo-suffix"> demo</span>
          <ArrowUpRight size={13} />
        </a>
        <a
          className="sidebar-nav-link sidebar-demo-link"
          href={appUrl("esports")}
          aria-label="Esports demo"
        >
          <Boxes size={17} />
          Esports<span className="sidebar-demo-suffix"> demo</span>
          <ArrowUpRight size={13} />
        </a>
        </div>
        <div className="sidebar-bottom">
          <Card className="sidebar-tip">
            <Sparkles size={17} />
            <strong>Made for your community.</strong>
            <p>
              Share a market with your viewers.
              <br />
              Shared settlement infrastructure.
            </p>
            <Link to="/integration">
              Integration guide <ArrowRight size={12} />
            </Link>
          </Card>
          <Link className="sidebar-nav-link" to="/integration">
            <CircleHelp size={16} />
            Quickstart documentation
          </Link>
          <div className="sidebar-footer">
            <span className="network-badge">
              <i />
              {mode === "mock" ? client.shared ? "Shared demo" : "Local demo" : "Solana Devnet"}
            </span>
            <small>v0.1.0</small>
          </div>
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={12} />
            <strong>{fundsPage ? "Wallet funds" : pathname === "/fortnite" ? "Livestream demo" : pathname === "/funding" ? "Funding model" : "Prediction markets"}</strong>
          </div>
          <div className="topbar-actions">
            <ThemeSwitch />
            <Badge tone={!fundsPage && (exhibition || mode === "mock") ? "warning" : "violet"}>
              {fundsPage ? "Devnet wallet" : exhibition ? "Exhibition" : mode === "mock" ? "Simulated demo" : "Devnet"}
            </Badge>
            {fundsPage ? <WalletMultiButton /> : exhibition ? <ExhibitionAccountBadge /> : <WalletButton />}
          </div>
        </header>
        <main id="main" className="dashboard-main">
          {["/overview", "/integration", "/events"].includes(pathname) && <nav className="developer-links" aria-label="Developer tools"><NavLink to="/overview">Overview</NavLink><NavLink to="/integration">Integration</NavLink><NavLink to="/events">Events</NavLink></nav>}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/help" element={<Help />} />
            <Route path="/fortnite" element={<FortniteDemo />} />
            <Route path="/livestream" element={<Navigate to="/fortnite" replace />} />
            <Route path="/wallet" element={<WalletFundsPage />} />
            <Route path="/funding" element={<FundingDemo />} />
            <Route path="/solana" element={<Navigate to="/funding" replace />} />
            <Route path="/markets/:marketId" element={<MarketPage />} />
            <Route path="/racing" element={<RacingApp embedded />} />
            <Route path="/esports" element={<EsportsApp embedded />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/markets/new" element={<CreateMarket />} />
            <Route path="/integration" element={<Integration />} />
            <Route path="/events" element={<Events />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <footer className="dashboard-footer">
            <span>hunch · Prediction infrastructure for your product.</span>
            <a
              href="https://hunchtrading.tech"
              target="_blank"
              rel="noopener noreferrer"
            >
              hunchtrading.tech
            </a>
            <span>
              {fundsPage ? "Devnet wallet · Test funds only" : exhibition ? "Browser exhibition · Nonredeemable credits" : mode === "mock"
                ? client.shared ? "Shared simulation · Nonredeemable demo credits" : "Local simulation · Nonredeemable demo credits"
                : "Devnet only · Nonredeemable HUNCH tokens"}
            </span>
          </footer>
        </main>
      </div>
    </div></DemoProvider></FundsProvider>
  );
}
