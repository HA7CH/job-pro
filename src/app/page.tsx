type Status = "live" | "wip" | "none";

type Company = {
  name: string;
  nameEn?: string;
  /** color used for the placeholder square icon */
  color: string;
  /** initial(s) shown on the placeholder */
  glyph: string;
  /** can we list jobs / read JDs right now? */
  fetch: Status;
  /** can we auto-apply right now? */
  apply: Status;
  /** repo path where this company's adapter lives (or will live) */
  href: string;
};

const COMPANIES: Company[] = [
  {
    name: "腾讯",
    nameEn: "Tencent",
    color: "#0067e6",
    glyph: "T",
    fetch: "live",
    apply: "wip",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/tencent.ts",
  },
  {
    name: "字节跳动",
    nameEn: "ByteDance",
    color: "#000",
    glyph: "B",
    fetch: "wip",
    apply: "wip",
    href: "https://github.com/HA7CH/job-pro/issues/new?title=Add+ByteDance+adapter",
  },
  {
    name: "滴滴",
    nameEn: "Didi",
    color: "#ff7733",
    glyph: "D",
    fetch: "wip",
    apply: "wip",
    href: "https://github.com/HA7CH/job-pro/issues/new?title=Add+Didi+adapter",
  },
  {
    name: "阿里",
    nameEn: "Alibaba",
    color: "#ff6a00",
    glyph: "A",
    fetch: "wip",
    apply: "wip",
    href: "https://github.com/HA7CH/job-pro/issues/new?title=Add+Alibaba+adapter",
  },
];

function StatusBadge({ status, label }: { status: Status; label: string }) {
  if (status === "live") {
    return (
      <span className={`status status-live`} aria-label={`${label}: live`}>
        <span className="status-dot" aria-hidden="true" />
        live
      </span>
    );
  }
  if (status === "wip") {
    return (
      <span className={`status status-wip`} aria-label={`${label}: 建设中`}>
        <span className="status-dot" aria-hidden="true" />
        building
      </span>
    );
  }
  return (
    <span className={`status status-none`} aria-label={`${label}: none`}>
      <span className="status-dot" aria-hidden="true" />
      none
    </span>
  );
}

export default function Home() {
  return (
    <main className="homepage">
      <article className="article">
        <header>
          <h1 className="brand">job.pro</h1>
          <p className="tagline">
            Query Chinese big-tech campus recruiting from your terminal.
          </p>
        </header>

        <section className="install">
          <code>npx job-pro@latest tencent search &ldquo;后台开发&rdquo;</code>
          <span className="install-hint">No signup. No token. No proxy.</span>
        </section>

        <section className="roadmap" aria-labelledby="roadmap-title">
          <h2 id="roadmap-title" className="section-title">
            Roadmap
          </h2>
          <ul className="company-list">
            {COMPANIES.map((company) => (
              <li key={company.name}>
                <a
                  href={company.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span
                    className="company-icon"
                    style={{ background: company.color }}
                    aria-hidden="true"
                  >
                    {company.glyph}
                  </span>
                  <span className="company-name">
                    <span className="company-name-cn">{company.name}</span>
                    {company.nameEn ? (
                      <span className="company-name-en">{company.nameEn}</span>
                    ) : null}
                  </span>
                  <span className="company-caps">
                    <span className="company-cap">
                      <span className="company-cap-label">get jobs</span>
                      <StatusBadge status={company.fetch} label="get jobs" />
                    </span>
                    <span className="company-cap">
                      <span className="company-cap-label">auto-apply</span>
                      <StatusBadge status={company.apply} label="auto-apply" />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="links">
          <a href="https://github.com/HA7CH/job-pro" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://www.npmjs.com/package/job-pro" target="_blank" rel="noopener noreferrer">
            npm
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://ha7ch.com" target="_blank" rel="noopener noreferrer">
            ha7ch
          </a>
        </section>
      </article>
    </main>
  );
}
