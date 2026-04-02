import { useEffect, useState } from 'react'
import './App.css'

const clusterColor = (clusterId) => `var(--cluster-${clusterId % 8})`

const formatNumber = (value) => new Intl.NumberFormat('en-US').format(value)

const formatScore = (value) => {
  if (value === null || value === undefined) {
    return '-'
  }
  return Number(value).toFixed(3)
}

function buildTimelinePath(rows, width, height, padding) {
  const maxScore = Math.max(...rows.map((row) => row.drift_score ?? 0), 0.01)
  return rows
    .map((row, index) => {
      const x = padding + (index / Math.max(rows.length - 1, 1)) * (width - padding * 2)
      const y =
        height - padding - (((row.drift_score ?? 0) / maxScore) * (height - padding * 2))
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function TimelineChart({ rows }) {
  const width = 920
  const height = 280
  const padding = 34
  const maxScore = Math.max(...rows.map((row) => row.drift_score ?? 0), 0.01)
  const labeledRows = rows.filter((_, index) => index % 5 === 0 || index === rows.length - 1)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = height - padding - ratio * (height - padding * 2)
        return (
          <g key={ratio}>
            <line className="grid-line" x1={padding} y1={y} x2={width - padding} y2={y} />
            <text className="grid-label" x="6" y={y + 4}>
              {(maxScore * ratio).toFixed(2)}
            </text>
          </g>
        )
      })}
      <path className="trend-line" d={buildTimelinePath(rows, width, height, padding)} />
      {rows.map((row, index) => {
        const x = padding + (index / Math.max(rows.length - 1, 1)) * (width - padding * 2)
        const y = height - padding - (((row.drift_score ?? 0) / maxScore) * (height - padding * 2))
        return (
          <circle className="trend-dot" key={row.year} cx={x} cy={y} r="4.8">
            <title>{`${row.year}: drift ${formatScore(row.drift_score)}`}</title>
          </circle>
        )
      })}
      {labeledRows.map((row) => {
        const index = rows.findIndex((item) => item.year === row.year)
        const x = padding + (index / Math.max(rows.length - 1, 1)) * (width - padding * 2)
        return (
          <text className="axis-label" key={row.year} x={x - 12} y={height - 10}>
            {row.year}
          </text>
        )
      })}
      <text className="axis-label" x={padding} y="22">
        Drift score between adjacent speeches
      </text>
    </svg>
  )
}

function LandscapeChart({ points }) {
  const width = 920
  const height = 460
  const padding = 26
  const sampled = points.filter((_, index) => index % 2 === 0)
  const xValues = sampled.map((point) => point.x)
  const yValues = sampled.map((point) => point.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <rect
        x={padding}
        y={padding}
        width={width - padding * 2}
        height={height - padding * 2}
        rx="26"
        fill="rgba(255,255,255,0.25)"
        stroke="rgba(29,36,45,0.08)"
      />
      <text className="axis-label" x={padding} y="22">
        Each point is a four-sentence speech window, colored by discovered theme.
      </text>
      {sampled.map((point) => {
        const x =
          padding + ((point.x - minX) / Math.max(maxX - minX, 1)) * (width - padding * 2)
        const y =
          height -
          padding -
          ((point.y - minY) / Math.max(maxY - minY, 1)) * (height - padding * 2)

        return (
          <circle
            className="landscape-point"
            key={point.id}
            cx={x}
            cy={y}
            r="4.1"
            fill={clusterColor(point.cluster_id)}
          >
            <title>{`${point.year} • ${point.president} • ${point.cluster_label}\n${point.excerpt}`}</title>
          </circle>
        )
      })}
    </svg>
  )
}

function App() {
  const [dashboard, setDashboard] = useState(null)
  const [segments, setSegments] = useState([])
  const [yearFilter, setYearFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') {
      return 'dark'
    }
    return window.localStorage.getItem('drifter-theme') ?? 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('drifter-theme', theme)
  }, [theme])

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await fetch('/api/dashboard')
        if (!response.ok) {
          throw new Error('Dashboard request failed.')
        }
        const payload = await response.json()
        setDashboard(payload)
      } catch (requestError) {
        setError(requestError.message)
      }
    }

    loadDashboard()
  }, [])

  useEffect(() => {
    if (!dashboard) {
      return
    }

    const controller = new AbortController()

    const loadSegments = async () => {
      try {
        const params = new URLSearchParams({ limit: '14' })
        if (yearFilter) {
          params.set('year', yearFilter)
        }
        if (clusterFilter) {
          params.set('cluster', clusterFilter)
        }

        const response = await fetch(`/api/segments?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('Segment request failed.')
        }

        const payload = await response.json()
        setSegments(payload.items)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message)
        }
      }
    }

    loadSegments()
    return () => controller.abort()
  }, [dashboard, yearFilter, clusterFilter])

  if (error) {
    return <div className="status-shell">Failed to load the analysis: {error}</div>
  }

  if (!dashboard) {
    return <div className="status-shell">Loading analysis...</div>
  }

  const metrics = [
    {
      label: 'Narrative clusters',
      value: dashboard.overview.cluster_count,
      note: 'Unsupervised thematic groupings extracted from the corpus.',
    },
    {
      label: 'Average drift',
      value: formatScore(dashboard.overview.avg_drift),
      note: 'Mean Jensen-Shannon divergence between adjacent years.',
    },
    {
      label: 'Largest drift',
      value: formatScore(dashboard.overview.max_drift),
      note: `Peak transition landed in ${dashboard.overview.max_drift_year}.`,
    },
    {
      label: 'Timeline rows',
      value: dashboard.timeline.length,
      note: 'One row per time slice in the current dataset.',
    },
  ]

  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero-copy">
          <div className="hero-topline">
            <p className="eyebrow">Drifter</p>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
          <h1>Detect how language, themes, and narratives shift across any evolving text stream.</h1>
          <p className="hero-text">
            Drifter is designed for any domain where text changes over time, including policy,
            media, customer feedback, research, and internal knowledge bases. This release uses
            the State of the Union corpus as the current demonstration dataset.
          </p>
        </div>
        <div className="dataset-card">
          <div>
            <p className="section-kicker">Current dataset</p>
            <h2 className="dataset-title">{dashboard.dataset.name}</h2>
            <p className="dataset-description">{dashboard.dataset.description}</p>
          </div>
          <div className="dataset-stat-row">
            <div className="dataset-stat">
              <span className="dataset-count">{formatNumber(dashboard.dataset.speech_count)}</span>
              <span className="dataset-label">speeches</span>
            </div>
            <div className="dataset-stat">
              <span className="dataset-count">{formatNumber(dashboard.dataset.segment_count)}</span>
              <span className="dataset-label">belief windows</span>
            </div>
            <div className="dataset-stat">
              <span className="dataset-count">
                {dashboard.dataset.year_range[0]}-{dashboard.dataset.year_range[1]}
              </span>
              <span className="dataset-label">year span</span>
            </div>
            <div className="dataset-stat">
              <span className="dataset-count">{formatNumber(dashboard.dataset.president_count)}</span>
              <span className="dataset-label">presidents</span>
            </div>
          </div>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel metrics-panel">
          <div className="section-heading">
            <p className="section-kicker">Overview</p>
            <h2>Dataset and model summary</h2>
          </div>
          <div className="metric-grid">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <span className="metric-label">{metric.label}</span>
                <span className="metric-value">{metric.value}</span>
                <p className="metric-note">{metric.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel timeline-panel">
          <div className="section-heading">
            <p className="section-kicker">Timeline</p>
            <h2>When the narrative shifts</h2>
          </div>
          <div className="chart-frame">
            <TimelineChart rows={dashboard.timeline} />
          </div>
        </section>

        <section className="panel stack-panel">
          <div className="section-heading">
            <p className="section-kicker">Cluster mix</p>
            <h2>Topic balance by year</h2>
          </div>
          <div>
            {dashboard.timeline.map((row) => (
              <article className="stack-row" key={row.year}>
                <div className="stack-year">{row.year}</div>
                <div className="stack-bar">
                  {row.cluster_shares.map((share, index) => (
                    <div
                      className="stack-segment"
                      key={`${row.year}-${index}`}
                      style={{
                        width: `${Math.max(share * 100, 1.5)}%`,
                        background: clusterColor(index),
                      }}
                      title={`Cluster ${index}: ${(share * 100).toFixed(1)}%`}
                    />
                  ))}
                </div>
                <div className="stack-president">{row.president}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel events-panel">
          <div className="section-heading">
            <p className="section-kicker">Drift events</p>
            <h2>Largest transitions in the corpus</h2>
          </div>
          <div className="event-grid">
            {dashboard.top_drift_events.map((event) => (
              <article className="event-card" key={`${event.from_year}-${event.to_year}`}>
                <span className="event-score">{formatScore(event.drift_score)}</span>
                <h3 className="event-years">
                  {event.from_year} to {event.to_year}
                </h3>
                <p className="event-copy">
                  Semantic shift {formatScore(event.semantic_shift)}. Leading themes:{' '}
                  {event.emerging_terms.join(', ')}.
                </p>
                <div className="event-tags">
                  {event.emerging_terms.map((term) => (
                    <span className="pill" key={`${event.to_year}-${term}`}>
                      {term}
                    </span>
                  ))}
                  {event.leading_changes.map((change) => (
                    <span className="pill" key={`${event.to_year}-${change.cluster_id}`}>
                      {change.label}: {change.delta > 0 ? '+' : ''}
                      {change.delta.toFixed(3)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel landscape-panel">
          <div className="section-heading">
            <p className="section-kicker">Semantic landscape</p>
            <h2>Belief windows in reduced feature space</h2>
          </div>
          <div className="chart-frame landscape-frame">
            <LandscapeChart points={dashboard.landscape} />
          </div>
        </section>

        <section className="panel cluster-panel">
          <div className="section-heading">
            <p className="section-kicker">Themes</p>
            <h2>Discovered narrative clusters</h2>
          </div>
          <div className="cluster-card-grid">
            {dashboard.clusters.map((cluster) => (
              <article className="cluster-card" key={cluster.cluster_id}>
                <div
                  className="cluster-accent"
                  style={{ background: clusterColor(cluster.cluster_id) }}
                />
                <h3 className="cluster-title">{cluster.label}</h3>
                <p className="cluster-meta">
                  {formatNumber(cluster.size)} segments · peak {cluster.peak_year} · share{' '}
                  {(cluster.peak_share * 100).toFixed(1)}%
                </p>
                <div className="cluster-keywords">
                  {cluster.keywords.map((keyword) => (
                    <span className="pill" key={`${cluster.cluster_id}-${keyword}`}>
                      {keyword}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel explorer-panel">
          <div className="section-heading">
            <p className="section-kicker">Explorer</p>
            <h2>Inspect source segments</h2>
          </div>
          <div className="filter-row">
            <label>
              <span>Year</span>
              <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                <option value="">All years</option>
                {dashboard.timeline.map((row) => (
                  <option key={row.year} value={row.year}>
                    {row.year} · {row.president}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Cluster</span>
              <select
                value={clusterFilter}
                onChange={(event) => setClusterFilter(event.target.value)}
              >
                <option value="">All clusters</option>
                {dashboard.clusters.map((cluster) => (
                  <option key={cluster.cluster_id} value={cluster.cluster_id}>
                    {cluster.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="segment-list">
            {segments.length ? (
              segments.map((segment) => (
                <article className="segment-card" key={segment.id}>
                  <p className="segment-meta">
                    {segment.year} · {segment.president} · {segment.cluster_label}
                  </p>
                  <p className="segment-text">{segment.text}</p>
                </article>
              ))
            ) : (
              <div className="empty-state">No segments match the selected filters.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
