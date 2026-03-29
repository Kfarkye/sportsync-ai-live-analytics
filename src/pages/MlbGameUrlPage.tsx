import React, { FC, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import SEOHead from "@/components/seo/SEOHead";
import { fetchMlbLiveUrlContext } from "@/services/mlbLiveUrlContextService";
import type { MlbLiveUrlContextResponse } from "@/types/mlbLiveUrlContext";

const LIVE_STATUSES = ["STATUS_IN_PROGRESS", "STATUS_DELAYED", "STATUS_HALFTIME"];

const containerStyle: React.CSSProperties = {
  maxWidth: 980,
  margin: "0 auto",
  padding: "28px 20px 72px",
  fontFamily: "'DM Sans', sans-serif",
  color: "#1A1A18",
};

const cardStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E8E7E3",
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

function formatNum(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.includes(status.toUpperCase());
}

export const MlbGameUrlPage: FC = () => {
  const { gameId = "" } = useParams<{ gameId: string }>();
  const [payload, setPayload] = useState<MlbLiveUrlContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        if (!mounted) return;
        const data = await fetchMlbLiveUrlContext(gameId, true);
        if (!mounted) return;
        setPayload(data);
        setError(null);
        const shouldPoll = isLiveStatus(data.canonical_game.status);
        if (shouldPoll) {
          timer = setTimeout(load, 20_000);
        }
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message ?? "Failed to load MLB game context.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    setLoading(true);
    setError(null);
    setPayload(null);
    void load();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

  const game = payload?.canonical_game ?? null;
  const title = useMemo(() => {
    if (!game) return "MLB Game Context";
    return `${game.teams.away.name ?? "Away"} at ${game.teams.home.name ?? "Home"} | MLB Game Context`;
  }, [game]);

  return (
    <>
      <SEOHead
        title={title}
        description="MLB pregame and live context with lines, lineups, run environment, starters, bullpen context, and pregame edges."
        canonicalPath={`/mlb/game/${encodeURIComponent(gameId)}`}
      />
      <main style={containerStyle}>
        <div style={{ marginBottom: 18, color: "#6B6B63", fontSize: 13 }}>
          <span>MLB Game URL</span>
          <span style={{ margin: "0 8px" }}>•</span>
          <span>{gameId}</span>
        </div>

        {loading ? (
          <div style={cardStyle}>Loading canonical game object…</div>
        ) : null}
        {error ? (
          <div style={cardStyle}>
            <strong>Unable to load game context.</strong>
            <div style={{ marginTop: 8, color: "#6B6B63" }}>{error}</div>
          </div>
        ) : null}

        {game ? (
          <>
            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Scoreboard Header
              </div>
              <h1 style={{ fontFamily: "'Source Serif 4', serif", fontSize: 32, lineHeight: 1.12, marginBottom: 10 }}>
                {game.teams.away.name ?? "Away"} @ {game.teams.home.name ?? "Home"}
              </h1>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#6B6B63", fontSize: 14 }}>
                <span>Status: {game.status}</span>
                <span>Away: {formatNum(game.teams.away.score)}</span>
                <span>Home: {formatNum(game.teams.home.score)}</span>
                <span>Start: {game.start_time_utc ?? "unknown"}</span>
              </div>
            </section>

            {payload?.live_output ? (
              <section style={cardStyle}>
                <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Live Insight
                </div>
                <div style={{ fontSize: 15, marginBottom: 6 }}><strong>What changed:</strong> {payload.live_output.what_changed}</div>
                <div style={{ fontSize: 15, marginBottom: 6 }}><strong>Why it matters:</strong> {payload.live_output.why_it_matters}</div>
                <div style={{ fontSize: 15 }}><strong>What to watch now:</strong> {payload.live_output.what_to_watch_now}</div>
              </section>
            ) : null}

            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Lines
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ color: "#9B9B91", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11 }}>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Snapshot</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Total</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Home ML</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Away ML</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Run Line</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "8px 0" }}>Opening</td>
                    <td>{formatNum(game.market.opening.total)}</td>
                    <td>{formatNum(game.market.opening.home_moneyline)}</td>
                    <td>{formatNum(game.market.opening.away_moneyline)}</td>
                    <td>{formatNum(game.market.opening.home_run_line)} / {formatNum(game.market.opening.away_run_line)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 0" }}>Current</td>
                    <td>{formatNum(game.market.current.total)}</td>
                    <td>{formatNum(game.market.current.home_moneyline)}</td>
                    <td>{formatNum(game.market.current.away_moneyline)}</td>
                    <td>{formatNum(game.market.current.home_run_line)} / {formatNum(game.market.current.away_run_line)}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Lineups / Availability
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                {[game.lineups.home, game.lineups.away].map((lineup, idx) => (
                  <div key={idx} style={{ border: "1px solid #E8E7E3", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{lineup?.team ?? "Unknown Team"}</div>
                    <div style={{ color: "#6B6B63", fontSize: 13, marginBottom: 8 }}>
                      Confirmed: {lineup?.confirmed === null ? "unknown" : lineup?.confirmed ? "yes" : "no"} · Confidence:{" "}
                      {lineup?.confidence_score === null ? "unknown" : formatPct(lineup?.confidence_score)}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      {(lineup?.batting_order ?? []).slice(0, 9).map((hitter, hitterIdx) => (
                        <li key={hitterIdx} style={{ marginBottom: 2, fontSize: 13 }}>
                          {hitter.player_name} {hitter.position ? `(${hitter.position})` : ""}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Run Environment
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div>Pregame weather: {game.environment.pregame.weather_summary ?? "unknown"}</div>
                <div>Live weather: {game.environment.live.weather_summary ?? "unknown"}</div>
                <div>Pregame index: {formatNum(game.environment.pregame.run_environment_index)}</div>
                <div>Live index: {formatNum(game.environment.live.run_environment_index)}</div>
                <div>Delta: {formatNum(game.environment.delta_run_environment)}</div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Starter Context
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  Home starter: {game.starters.home?.name ?? "unknown"} · {game.starters.home?.hand ?? "?"} · ERA{" "}
                  {formatNum(game.starters.home?.era ?? null)} · WHIP {formatNum(game.starters.home?.whip ?? null)}
                </div>
                <div>
                  Away starter: {game.starters.away?.name ?? "unknown"} · {game.starters.away?.hand ?? "?"} · ERA{" "}
                  {formatNum(game.starters.away?.era ?? null)} · WHIP {formatNum(game.starters.away?.whip ?? null)}
                </div>
                <div>
                  Current pitcher: {game.live_state.current_pitcher.name ?? "unknown"} · pitch count{" "}
                  {formatNum(game.live_state.current_pitcher.pitch_count)}
                </div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Bullpen Context
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  {game.bullpens.home?.team ?? "Home"} fatigue: {formatNum(game.bullpens.home?.fatigue_score ?? null)} · avg pitches (last 3):{" "}
                  {formatNum(game.bullpens.home?.avg_pitches_last_3 ?? null)}
                </div>
                <div>
                  {game.bullpens.away?.team ?? "Away"} fatigue: {formatNum(game.bullpens.away?.fatigue_score ?? null)} · avg pitches (last 3):{" "}
                  {formatNum(game.bullpens.away?.avg_pitches_last_3 ?? null)}
                </div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ fontSize: 12, color: "#9B9B91", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Pregame Edges
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {game.pregame_edges.map((edge) => (
                  <li key={edge.edge_key} style={{ marginBottom: 6 }}>
                    <strong>{edge.title}:</strong> {edge.detail}
                  </li>
                ))}
              </ul>
            </section>

          </>
        ) : null}
      </main>
    </>
  );
};

export default MlbGameUrlPage;
