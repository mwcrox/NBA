import {
    FEED,
    normalizeEvent,
    mergeGames,
    scoreSeason,
    ownerScores,
    seriesAllocation,
    ROUND_NAMES
} from "./assets/scoring.mjs";

import { parseLeague } from "./assets/league.mjs";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const escape = s => String(s ?? "").replace(
    /[&<>"']/g,
    c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c])
);

const fmt = n => Number(n).toLocaleString(
    "en-US",
    { maximumFractionDigits: 1 }
);

const state = {
    year: null,
    teams: [],
    league: null,
    snapshot: null,
    scored: null,
    filter: "all",
    busy: false
};

async function fetchJSON(url) {
    const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(18000)
    });

    if (!response.ok) {
        throw new Error(`Unable to load ${url} (${response.status})`);
    }

    return response.json();
}

function draft() {
    return state.league.picks;
}

function ownerOf(id) {
    const pick = draft().find(p => p.team === id);
    return state.league.owners.find(o => o.id === pick?.owner);
}

function team(id) {
    return state.teams.find(t => t.id === id);
}

function logo(t) {
    return `
    <img
      class="team-logo"
      src="${escape(t.logo)}"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
    >
  `;
}

function dot(id) {
    const owner = ownerOf(id);

    return owner
        ? `<span
         class="owner-dot"
         style="background:${escape(owner.color)}"
         title="${escape(owner.name)}"
       ></span>`
        : "";
}

function notice(text, error = false) {
    $("#notice").textContent = text;
    $("#notice").hidden = !text;
    $("#notice").classList.toggle("error", error);
}

function score() {
    state.scored = scoreSeason(
        state.teams,
        state.snapshot.games,
        state.snapshot.clinched
    );
}

function render() {
    score();

    const picks = draft();

    const owners = ownerScores(
        state.scored,
        picks,
        state.league.owners
    );

    const max = Math.max(...owners.map(o => o.total));


    $("#scoreboard").innerHTML = owners.map((owner, index) => {
        const leading =
            owner.total === max &&
            owners[0].total !== owners[1].total;

        return `
      <article class="score-card ${index ? "purple" : ""}">
        <div class="owner-line">
          <span class="avatar">${escape(owner.name[0])}</span>

          <div>
            <h2>${escape(owner.name)}</h2>
            <small>${owner.roster.length} drafted teams</small>
          </div>

          ${leading
                ? '<span class="leader-badge">LEADING</span>'
                : ""}
        </div>

        <div class="score-value">
          ${fmt(owner.total)}<small>PTS</small>
        </div>
      </article>
    `;
    }).join("");

    const total = owners.reduce(
        (sum, owner) => sum + owner.total,
        0
    );

    const diff = Math.abs(
        owners[0].total - owners[1].total
    );

    $("#race-bar span").style.width =
        `${total ? owners[0].total / total * 100 : 50}%`;

    $("#lead").textContent = picks.length
        ? diff
            ? `${owners.find(o => o.total === max).name} leads by ${fmt(diff)} points`
            : "All tied up"
        : "The rivalry starts with your draft";

    if (!picks.length) {
        notice(
            "The 2026–2027 draft has not been set yet."
        );
    }

    renderGames();
    renderRosters(owners, picks);
    renderPlayoffs();
}

function renderGames() {
    let games = state.snapshot.games.filter(
        game => game.phase !== "excluded"
    );

    if (state.filter === "rivalry") {
        games = games.filter(game => {
            const a = ownerOf(game.sides[0].id);
            const b = ownerOf(game.sides[1].id);
            return a && b && a.id !== b.id;
        });
    }

    const now = Date.now();

    const live = games.filter(
        game => game.state === "in"
    );

    const upcoming = games.filter(game =>
        game.state === "pre" &&
        new Date(game.date).getTime() >= now - 6 * 3600000
    ).slice(0, 6);

    const recent = games
        .filter(game => game.completed)
        .slice(-6)
        .reverse();

    const shown = mergeGames(live);

    for (const game of upcoming) {
        if (
            shown.length < 6 &&
            !shown.some(s => s.id === game.id)
        ) {
            shown.push(game);
        }
    }

    for (const game of recent) {
        if (
            shown.length < 6 &&
            !shown.some(s => s.id === game.id)
        ) {
            shown.push(game);
        }
    }

    if (!shown.length) {
        const rivalry = state.filter === "rivalry";

        $("#games").innerHTML = `
      <div class="empty">
        <h2>
          ${rivalry
                ? "No head-to-head matchups yet"
                : "The next tipoff is coming"}
        </h2>
        <p>
          ${rivalry
                ? "Head-to-head matchups will appear after both rosters are set."
                : "Games will appear automatically when the season schedule is available."}
        </p>
      </div>
    `;

        return;
    }

    $("#games").innerHTML = shown.map(game => {
        const date = new Date(game.date).toLocaleDateString(
            "en-US",
            {
                month: "short",
                day: "numeric"
            }
        );

        const status = game.state === "pre"
            ? new Date(game.date).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short"
            })
            : game.status;

        const winner = game.winner
            ? team(game.winner)
            : null;

        const roundLabel = game.phase === "playoff"
            ? ROUND_NAMES[game.round].toUpperCase()
            : "REGULAR SEASON";

        const sides = [...game.sides].sort(
            (a, b) => Number(a.home) - Number(b.home)
        );

        let foot;

        if (winner) {
            const clinchedSeries =
                game.phase === "playoff" &&
                state.scored.series.some(series =>
                    series.winner === winner.id &&
                    series.games
                        .filter(g => g.completed)
                        .at(-1)?.id === game.id
                );

            foot =
                `${escape(winner.abbr)} earned ` +
                `${game.phase === "regular" ? "0.5" : "1"} point` +
                `${game.phase === "playoff" ? " for the game win" : ""}` +
                `${clinchedSeries ? " · Series clinched" : ""}`;
        } else if (game.state === "in") {
            foot = "In progress · Points awarded at final";
        } else {
            foot = game.phase === "playoff"
                ? "1 point per win · 7 points in the series"
                : "0.5 points at stake";
        }

        return `
      <article class="game">
        <div class="game-top">
          <span>${escape(date.toUpperCase())} · ${escape(roundLabel)}</span>
          <span class="${game.state === "in" ? "game-live" : ""}">
            ${escape(status)}
          </span>
        </div>

        ${sides.map(side => `
          <div class="game-row">
            ${logo(team(side.id))}
            <span>
              ${escape(team(side.id).shortName)} ${dot(side.id)}
            </span>
            <span class="game-score">
              ${game.state === "pre" ? "—" : side.score}
            </span>
          </div>
        `).join("")}

        <div class="game-foot">${foot}</div>
      </article>
    `;
    }).join("");
}

function renderRosters(owners, picks) {
    $("#rosters").innerHTML = owners.map((owner, index) => `
    <article class="roster ${index ? "purple" : ""}">
      <div class="roster-header">
        <span class="avatar">${escape(owner.name[0])}</span>

        <div>
          <h2>${escape(owner.name)}’s teams</h2>
          <small>${owner.roster.length} of 15 teams drafted</small>
        </div>

        <strong>${fmt(owner.total)}</strong>
      </div>

      ${owner.roster.length
            ? owner.roster.map((t, rosterIndex) => `
            <div class="roster-row">
              <span class="pick-number">
                ${rosterIndex + 1}
              </span>

              ${logo(t)}

              <div>
                ${escape(t.name)}
                <span class="team-meta">
                  ${t.wins}–${t.losses}
                </span>
              </div>

              <span class="points">${fmt(t.total)}</span>
            </div>
          `).join("")
            : '<div class="empty">Roster not set yet.</div>'}
    </article>
  `).join("");

    $("#all-team-rows").innerHTML = [...state.scored.teams]
        .sort(
            (a, b) =>
                b.total - a.total ||
                a.name.localeCompare(b.name)
        )
        .map(t => `
      <tr>
        <td>${escape(t.name)} ${dot(t.id)}</td>
        <td>${t.wins}–${t.losses}</td>
        <td><strong>${fmt(t.total)}</strong></td>
      </tr>
    `).join("");
}

function renderPlayoffs() {
    const series = state.scored.series;

    if (!series.length) {
        $("#playoff-content").innerHTML = `
      <div class="empty">
        <h2>The postseason is taking shape</h2>
        <p>
          Series will appear automatically once the playoff matchups
          are confirmed. Qualifying teams earn 7 points each.
        </p>
        <a class="button secondary" href="#rules">
          Explore the scoring
        </a>
      </div>
    `;

        return;
    }

    $("#playoff-content").innerHTML = [1, 2, 3, 4].map(round => {
        const rows = series.filter(s => s.round === round);

        const cards = rows.map(s => `
      <article class="series-card">
        <div class="game-top">
          <span>
            ${s.conference === "NBA"
                ? "CHAMPIONSHIP"
                : s.conference.toUpperCase()}
          </span>
          <span>${s.winner ? "FINAL" : "IN PLAY"}</span>
        </div>

        ${s.ids.map((id, i) => `
          <div class="game-row">
            ${logo(team(id))}
            <span>${escape(team(id).abbr)} ${dot(id)}</span>
            <span class="game-score">${s.wins[i]}</span>
          </div>
        `).join("")}

        <div class="series-points">
          ${s.ids.map((id, i) => `
            <span>
              ${escape(team(id).abbr)}
              <strong>${s.awarded[i]} pts</strong>
            </span>
          `).join("")}
        </div>

        ${round === 3 && s.winner
                ? `<div class="title-bonus">
               +10 ${escape(team(s.winner).abbr)} · Conference champion
             </div>`
                : ""}
      </article>
    `).join("");

        return `
      <div class="round-heading">
        <h2>${ROUND_NAMES[round]}</h2>
        <span>
          ${round === 3
                ? "7 series points + 10 for each champion"
                : "7 points per series"}
        </span>
      </div>

      ${rows.length
                ? `<div class="series-grid">${cards}</div>`
                : '<p class="section-help">Matchups to be determined.</p>'}
    `;
    }).join("");
}

function renderCalculator() {
    const loss = Number($("#series-result").value);
    const bonus = $("#conference-check").checked ? 10 : 0;

    const [winner, loser] = seriesAllocation(4, loss);

    $("#calculator-result").innerHTML = `
    <div class="calc-scores">
      <div>
        <small>SERIES WINNER</small>
        <strong>${winner + bonus}</strong>
      </div>
      <div>
        <small>SERIES LOSER</small>
        <strong>${loser}</strong>
      </div>
    </div>

    <p class="calc-explain">
      Winner: 4 game wins + ${3 - loss} unplayed-game points
      ${bonus ? " + 10 conference bonus" : ""}.
      Loser: ${loss} game-win point${loss === 1 ? "" : "s"}.
    </p>
  `;
}

function navigate() {
    const requested = location.hash.slice(1);

    const page = ["home", "teams", "playoffs", "rules"].includes(requested)
        ? requested
        : "home";

    $$(".page").forEach(element => {
        element.hidden = element.id !== page;
    });

    $$("nav a").forEach(link => {
        if (link.dataset.page === page) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });
}

function dateCode(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date).replaceAll("-", "");
}

async function refresh(initial = false) {
    if (state.busy) return;

    state.busy = true;
    $("#refresh").disabled = true;

    const year = state.year;

    try {
        const snapshot = await fetchJSON(
            `data/seasons/${year}.json`
        );

        if (
            snapshot.schemaVersion !== 1 ||
            snapshot.season !== year
        ) {
            throw new Error("Unexpected season data");
        }

        let live = false;

        if (!snapshot.complete) {
            try {
                const dates = [
                    dateCode(new Date()),
                    dateCode(new Date(Date.now() - 86400000))
                ];

                const results = await Promise.all(
                    dates.map(date =>
                        fetchJSON(`${FEED}?dates=${date}`)
                    )
                );

                const additions = results.flatMap(result => {
                    if (!Array.isArray(result.events)) {
                        throw new Error("Unavailable scores");
                    }

                    return result.events
                        .map(normalizeEvent)
                        .filter(game =>
                            game &&
                            game.year === year &&
                            game.phase !== "excluded"
                        );
                });

                const updatedGames = mergeGames(
                    snapshot.games,
                    additions
                );

                scoreSeason(
                    state.teams,
                    updatedGames,
                    snapshot.clinched
                );

                snapshot.games = updatedGames;
                live = true;
            } catch {
                // Saved season data remains available if live refresh fails.
            }
        }

        scoreSeason(
            state.teams,
            snapshot.games,
            snapshot.clinched
        );

        state.snapshot = snapshot;

        notice("");
        render();

        const saved = new Date(snapshot.updatedAt);

        const old =
            Date.now() - saved.getTime() > 2 * 3600000;

        $("#freshness").textContent = live
            ? `Live scores checked ${new Date().toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit"
            })}`
            : `Saved ${saved.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            })}`;

        $("#freshness").title =
            `Full season snapshot: ${saved.toLocaleString()}`;

        if (old && !snapshot.complete) {
            notice(
                `The full season snapshot is from ${saved.toLocaleString()}. ` +
                (live
                    ? "Recent game results are refreshing, but older corrections and playoff berths may be delayed."
                    : "Showing saved results until automatic updates reconnect."),
                true
            );
        } else if (
            !live &&
            !snapshot.complete &&
            draft().length
        ) {
            notice(
                "Showing the latest saved scores. Live refresh is temporarily unavailable."
            );
        }

        return true;
    } catch (error) {
        notice(
            state.snapshot
                ? "The refresh failed. Your last loaded scores are still displayed."
                : "Unable to load season data. Please retry after the site’s first successful update.",
            true
        );

        if (initial) console.error(error);

        return false;
    } finally {
        state.busy = false;
        $("#refresh").disabled = false;
    }
}

$("#series-result").addEventListener(
    "change",
    renderCalculator
);

$("#conference-check").addEventListener(
    "change",
    renderCalculator
);

window.addEventListener("hashchange", navigate);

$("#refresh").addEventListener(
    "click",
    () => refresh()
);

$$("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        state.filter = button.dataset.filter;

        $$("[data-filter]").forEach(other => {
            other.setAttribute(
                "aria-pressed",
                String(other === button)
            );
        });

        if (state.snapshot) renderGames();
    });
});

async function init() {
    try {
        const [teams, league] = await Promise.all([
            fetchJSON("data/teams.json"),
            fetchJSON("league.json")
        ]);

        state.teams = teams;
        state.league = parseLeague(league, teams);
        state.year = state.league.season;

        $("#season-label").textContent =
            `${state.year - 1}–${state.year} season`;

        document.title =
            `${league.title || league.owners.map(o => o.name).join(" vs. ")} ` +
            "| NBA Fantasy Draft";

        await refresh(true);

        setInterval(() => {
            if (!document.hidden) {
                refresh();
            }
        }, 60000);

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                refresh();
            }
        });
    } catch (error) {
        notice(
            "Unable to load the site. Check your connection and try refreshing.",
            true
        );

        console.error(error);
    }
}

navigate();
renderCalculator();
init();