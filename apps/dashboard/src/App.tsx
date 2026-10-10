import { appUrl } from "../../shared/links";
import { useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
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
  useMarketKit,
  useMarkets,
  type CreateMarketParams,
  type Market,
  type MarketEvent,
} from "@marketkit/react";

const NAV = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/markets", label: "Markets", icon: Layers3 },
  { path: "/integration", label: "Integration", icon: Code2 },
  { path: "/events", label: "Events", icon: Activity },
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
  const { mode } = useMarketKit();
  return (
    <div className="mode-notice">
      <span>
        <ShieldCheck size={14} />
        {mode === "mock"
          ? "Demo workspace · all markets, balances, and events are simulated locally."
          : "Live SDK workspace · Solana Devnet · nonredeemable test tokens."}
      </span>
      <span>
        {mode === "mock" ? "NO BLOCKCHAIN TRANSACTIONS" : "DEVNET ONLY"}
      </span>
    </div>
  );
}
function PageTitle({
  eyebrow,
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
        <span className="eyebrow">{eyebrow}</span>
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
  return (
    <div className="market-table-wrap">
      <table className="market-table">
        <thead>
          <tr>
            <th>Market</th>
            <th>Status</th>
            <th>Pool</th>
            {!compact && <th>Closes</th>}
            {!compact && <th>Created</th>}
            <th>
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => (
            <tr key={market.id}>
              <td>
                <Link
                  to={`/integration?market=${encodeURIComponent(market.id)}`}
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
              <td>
                <MarketStatus status={effectiveStatus(market)} />
              </td>
              <td>
                <strong className="tabular">
                  {formatTokens(market.totalPool)}
                </strong>
                <small> TEST</small>
              </td>
              {!compact && (
                <td className="table-date">{date(market.closesAt)}</td>
              )}
              {!compact && (
                <td className="table-date">
                  {market.createdAt ? date(market.createdAt) : "Not provided"}
                </td>
              )}
              <td>
                <Link
                  className="table-open"
                  to={`/integration?market=${encodeURIComponent(market.id)}`}
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
  const { mode } = useMarketKit();
  const markets = useMarkets();
  const events = useEvents();
  const list = markets.data ?? [];
  const pool = list.reduce((sum, market) => sum + market.totalPool, 0n);
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
        list.filter((market) => effectiveStatus(market) === "open").length,
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
      detail: "TEST · zero-decimal tokens",
      icon: ArrowDownLeft,
    },
  ];
  return (
    <>
      <PageTitle
        eyebrow="YOUR DEVELOPER WORKSPACE"
        title="Good ideas. Shared outcomes."
        subtitle="Everything you need to bring prediction markets into your product."
        action={
          <Link className="mk-button mk-button-primary" to="/markets/new">
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
            {list.slice(0, 5).map((market, index) => (
              <div key={market.id} className="pool-row">
                <span className="pool-row-icon">
                  <Layers3 size={14} />
                </span>
                <div>
                  <div>
                    <span>
                      {market.application ?? market.outcomes.join(" vs ")}
                    </span>
                    <strong className="tabular">
                      {formatTokens(market.totalPool)} <small>TEST</small>
                    </strong>
                  </div>
                  <span className={`pool-row-track pool-color-${index % 3}`}>
                    <span
                      style={{
                        transform: `scaleX(${pool === 0n ? 0 : Number((market.totalPool * 1000n) / pool) / 1000})`,
                      }}
                    />
                  </span>
                </div>
              </div>
            ))}
            {!markets.isPending && list.length === 0 && (
              <EmptyState title="Your first market starts here">
                <Link
                  className="mk-button mk-button-secondary"
                  to="/markets/new"
                >
                  Create a market
                </Link>
              </EmptyState>
            )}
          </div>
          <div className="panel-footnote">
            Pooled stakes, measured in nonredeemable TEST tokens.
          </div>
        </Card>
        <Card className="quickstart-card">
          <div className="quickstart-icon">
            <FileCode2 size={24} />
          </div>
          <span className="kicker">BUILT FOR DEVELOPERS</span>
          <h2>
            From an idea
            <br />
            to an integration.
          </h2>
          <p>
            Create a market. Copy a component.
            <br />
            Let your community make the call.
          </p>
          <pre>
            <code>
              <span>import</span> {"{ PredictionMarket }"}
              {"\n"}
              <span>from</span> <b>'@marketkit/react'</b>;{"\n\n"}
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
            <Link className="mk-button mk-button-secondary" to="/markets/new">
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
  const query = useMarkets();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const list = (query.data ?? []).filter(
    (market) =>
      (filter === "all" || effectiveStatus(market) === filter) &&
      `${market.question} ${market.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="MARKET INFRASTRUCTURE"
        title="Your markets"
        subtitle="Create, monitor, and embed markets across your applications."
        action={
          <Link className="mk-button mk-button-primary" to="/markets/new">
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
          <EmptyState title="No matching markets">
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        )}
        <div className="table-footnote">
          {list.length} market{list.length !== 1 ? "s" : ""} · Solana Devnet
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
  const { client, mode, notify } = useMarketKit();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [outcomeA, setOutcomeA] = useState("");
  const [outcomeB, setOutcomeB] = useState("");
  const [closing, setClosing] = useState(() =>
    localDatetime(Date.now() + 3600000),
  );
  const [description, setDescription] = useState("");
  const [validation, setValidation] = useState("");
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
          ? "Simulated market created. Your integration is ready."
          : "Market creation confirmed on Devnet.",
      );
      navigate(`/integration?market=${encodeURIComponent(result.market.id)}`, {
        state: { transaction: result.transaction },
      });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const closesAt = Math.floor(new Date(closing).getTime() / 1000);
    if (
      !question.trim() ||
      !outcomeA.trim() ||
      !outcomeB.trim() ||
      outcomeA.trim().toLowerCase() === outcomeB.trim().toLowerCase() ||
      !Number.isFinite(closesAt) ||
      closesAt <= Date.now() / 1000
    ) {
      setValidation(
        "Enter a question, two distinct outcomes, and a future closing time.",
      );
      return;
    }
    setValidation("");
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
          <form onSubmit={submit}>
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
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={200}
                required
                placeholder="Who wins the championship final?"
              />
              <small>This question appears at the top of your widget.</small>
            </div>
            <div className="form-outcomes">
              <div className="form-field">
                <label htmlFor="outcome-a">Outcome A</label>
                <input
                  id="outcome-a"
                  value={outcomeA}
                  onChange={(event) => setOutcomeA(event.target.value)}
                  maxLength={60}
                  required
                  placeholder="Team Nova"
                />
              </div>
              <div className="form-field">
                <label htmlFor="outcome-b">Outcome B</label>
                <input
                  id="outcome-b"
                  value={outcomeB}
                  onChange={(event) => setOutcomeB(event.target.value)}
                  maxLength={60}
                  required
                  placeholder="Team Titan"
                />
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
                onChange={(event) => setClosing(event.target.value)}
                min={localDatetime(Date.now() + 60000)}
                required
              />
              <small>Shown in your browser’s local timezone.</small>
            </div>
            {validation && <ErrorState error={validation} />}
            {create.error && <ErrorState error={create.error} />}
            <div className="form-submit">
              <Link className="mk-button mk-button-ghost" to="/markets">
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
            MarketKit uses binary pooled predictions with integer TEST tokens.
            No order books or fixed payout odds.
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
            <span>Solana Devnet only</span>
          </div>
          <p className="guide-note">
            {mode === "mock"
              ? "This creates a local simulated market. No tokens are transferred on-chain."
              : "Your wallet signs market creation through the SDK. The authorized resolver submits the result."}
          </p>
        </aside>
      </div>
    </>
  );
}
function Integration() {
  const { client, mode } = useMarketKit();
  const markets = useMarkets();
  const [params, setParams] = useSearchParams();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [variant, setVariant] = useState<"default" | "compact">("default");
  const marketId =
    params.get("market") ??
    markets.data?.[0]?.id ??
    import.meta.env.VITE_MARKETKIT_MARKET_ID ??
    "race-42";
  const market = useMarket(marketId);
  const snippet = `import { PredictionMarket } from "@marketkit/react";\nimport "@marketkit/react/styles.css";\n\n// Inside the MarketKitProvider configured below:\n<PredictionMarket\n  marketId=${JSON.stringify(marketId)}\n  theme="${theme}"\n  variant="${variant}"\n/>`;
  const providerSnippet = `import { MarketKitProvider } from "@marketkit/react";\n\n<MarketKitProvider mode="${mode}">\n  <App />\n</MarketKitProvider>`;
  return (
    <>
      <PageTitle
        eyebrow="YOUR PRODUCT. OUR INFRASTRUCTURE."
        title="Integrate in minutes"
        subtitle="One React component. A complete prediction experience."
      />
      <ModeNotice />
      <div className="integration-layout">
        <div>
          <Card className="integration-config">
            <div className="panel-heading">
              <h2>Configure your widget</h2>
              <Badge>React</Badge>
            </div>
            <div className="integration-fields">
              <div className="form-field">
                <label htmlFor="market-select">Market</label>
                <select
                  id="market-select"
                  value={marketId}
                  onChange={(event) =>
                    setParams({ market: event.target.value })
                  }
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
                  <label htmlFor="theme">Theme</label>
                  <select
                    id="theme"
                    value={theme}
                    onChange={(event) =>
                      setTheme(event.target.value as "dark" | "light")
                    }
                  >
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
                <code>npm install</code>
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
                  Pass Developer B’s <code>sdkBindings</code>, the deployed{" "}
                  <code>programId</code>, and <code>tokenMint</code> to the
                  provider in SDK mode. Mock mode works without them.
                </p>
              </div>
            </div>
          </Card>
        </div>
        <aside>
          <div className="preview-heading">
            <span>LIVE COMPONENT PREVIEW</span>
            <Badge>{mode === "mock" ? "Simulated" : "Devnet"}</Badge>
          </div>
          <PredictionMarket
            key={marketId}
            marketId={marketId}
            theme={theme}
            variant={variant}
          />
          <Card className="network-info">
            <h3>Integration details</h3>
            <div>
              <span>Market ID</span>
              <code>{marketId}</code>
            </div>
            <div>
              <span>Status</span>
              {market.data && (
                <MarketStatus status={effectiveStatus(market.data)} />
              )}
            </div>
            <div>
              <span>Network</span>
              <strong>Solana Devnet</strong>
            </div>
            <div>
              <span>Contract</span>
              <code>{client.programId ?? "Awaiting deployment"}</code>
            </div>
            <div>
              <span>Mode</span>
              <strong>
                {mode === "mock" ? "Local simulation" : "Live SDK"}
              </strong>
            </div>
          </Card>
        </aside>
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
  if (!events.length)
    return (
      <EmptyState title="No events yet">
        <Link className="mk-button mk-button-secondary" to="/markets/new">
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
          <div>
            <strong>{event.message}</strong>
            <span>
              {event.marketId}{" "}
              {!compact && `· ${event.type.replace(/_/g, " ")}`}
            </span>
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
      <Card className="events-panel">
        <div className="panel-heading">
          <h2>Recent activity</h2>
          <select
            aria-label="Filter event type"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All events</option>
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
  const { mode } = useMarketKit();
  return (
    <div className="dashboard-app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="dashboard-sidebar">
        <Link to="/" className="sidebar-logo">
          <Logo />
        </Link>
        <div className="workspace-switch">
          <span className="workspace-avatar">M</span>
          <div>
            <strong>HackRU workspace</strong>
            <small>
              {mode === "mock" ? "Demo environment" : "Devnet environment"}
            </small>
          </div>
          <Badge>DEV</Badge>
        </div>
        <span className="sidebar-section-label">WORKSPACE</span>
        <nav aria-label="Developer dashboard">
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
        <span className="sidebar-section-label demos-label">
          EXAMPLE APPLICATIONS
        </span>
        <a className="sidebar-nav-link" href={appUrl("racing")}>
          <Flag size={17} />
          Racing demo
          <ArrowUpRight size={13} />
        </a>
        <a className="sidebar-nav-link" href={appUrl("esports")}>
          <Boxes size={17} />
          Esports demo
          <ArrowUpRight size={13} />
        </a>
        <div className="sidebar-bottom">
          <Card className="sidebar-tip">
            <Sparkles size={17} />
            <strong>Built to be embedded.</strong>
            <p>
              Your interface. Your community.
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
              Solana Devnet
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
            <strong>Developer console</strong>
          </div>
          <div className="topbar-actions">
            <Badge tone={mode === "mock" ? "warning" : "violet"}>
              {mode === "mock" ? "Simulated demo" : "Devnet"}
            </Badge>
            <WalletButton />
          </div>
        </header>
        <main id="main" className="dashboard-main">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/markets/new" element={<CreateMarket />} />
            <Route path="/integration" element={<Integration />} />
            <Route path="/events" element={<Events />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="dashboard-footer">
            <span>MarketKit · Prediction infrastructure for your product.</span>
            <span>Devnet only · Nonredeemable TEST tokens</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
