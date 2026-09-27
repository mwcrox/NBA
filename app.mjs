import {
    FEED,
    normalizeEvent,
    mergeGames,
    scoreSeason,
    ownerScores,
    validateDraft,
    seriesAllocation,
    ROUND_NAMES
} from "./assets/scoring.mjs";

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
    index: null,
    snapshot: null,
    scored: null,
    filter: "all",
    owner: null,
    busy: false
};

const storageKey = year => `nba-fantasy-draft-v1-${year}`;

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

function localDraft() {
    try {
        const value = JSON.parse(
            localStorage.getItem(storageKey(state.year))
        );

        if (value) {
            return validateDraft(value, state.teams, state.league.owners);
        }
    } catch { }

    return null;
}

function draft() {
    return localDraft()
        ?? state.league.drafts[String(state.year)]
        ?? [];
}

function saveDraft(picks) {
    validateDraft(picks, state.teams, state.league.owners);

    try {
        localStorage.setItem(
            storageKey(state.year),
            JSON.stringify(picks)
        );
    } catch {
        throw new Error(
            "This browser cannot save the draft. Enable browser storage and try again."
        );
    }
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

function localNotice() {
    const local = localDraft();
    const base = state.league.drafts[String(state.year)] || [];

    const differing = local
        && JSON.stringify(local) !== JSON.stringify(base);

    $("#local-notice").hidden = !differing;

    $("#local-notice").textContent =
        "You’re viewing a draft saved on this device. Download league.json " +
        "from Manage draft and upload it to GitHub to share these rosters.";
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
    localNotice();

    const picks = draft();
    const owners = ownerScores(
        state.scored,
        picks,
        state.league.owners
    );

    const max = Math.max(...owners.map(o => o.total));

    $("#season-caption").textContent =
        `${state.snapshot.label} NBA season · ` +
        (state.snapshot.complete
            ? "Final results"
            : "Automatic scores. All season long.");

    $("#scoreboard").innerHTML = owners.map((owner, index) => {
        const leading =
            owner.total === max &&
            owners[0].total !== owners[1].total;

        const breakdown = [
            ["Regular season", owner.regular],
            ["Playoff entry", owner.entry],
            ["Series points", owner.series],
            ["Conference", owner.conference]
        ];

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

        <div class="score-breakdown">
          ${breakdown.map(([label, value]) => `
            <div>
              <small>${label}</small>
              <strong>${fmt(value)}</strong>
            </div>
          `).join("")}
        </div>
      </article>
    `;
    }).join("");

    const total = owners.reduce((sum, owner) => sum + owner.total, 0);
    const diff = Math.abs(owners[0].total - owners[1].total);

    $("#race-bar span").style.width =
        `${total ? owners[0].total / total * 100 : 50}%`;

    $("#lead").textContent = picks.length
        ? diff
            ? `${owners.find(o => o.total === max).name} leads by ${fmt(diff)} points`
            : "All tied up"
        : "The rivalry starts with your draft";

    $("#awarded").textContent =
        `${fmt(state.scored.totals.total)} / 852 league points awarded`;

    if (!picks.length) {
        notice(
            "No draft has been published for this season. " +
            "Choose Manage draft to assign your teams."
        );
    }

    const seasonStats = [
        [
            "REGULAR-SEASON GAMES",
            state.scored.totals.regular * 2,
            "/ 1,230"
        ],
        [
            "PLAYOFF TEAMS",
            state.scored.qualified.length,
            "/ 16"
        ],
        [
            "SERIES COMPLETED",
            state.scored.series.filter(s => s.winner).length,
            "/ 15"
        ],
        [
            "CONFERENCE CHAMPIONS",
            state.scored.totals.conference / 10,
            "/ 2"
        ]
    ];

    $("#season-stats").innerHTML = seasonStats.map(
        ([label, value, denominator]) => `
      <div>
        <small>${label}</small>
        <strong>${fmt(value)}</strong>
        <span>${denominator}</span>
      </div>
    `
    ).join("");

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

    const live = games.filter(game => game.state === "in");

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
        if (shown.length < 6 && !shown.some(s => s.id === game.id)) {
            shown.push(game);
        }
    }

    for (const game of recent) {
        if (shown.length < 6 && !shown.some(s => s.id === game.id)) {
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
                ? "Assign teams to both owners to find games between your rosters."
                : "Games will appear automatically when the season schedule is available."}
        </p>
      </div>
    `;

        return;
    }

    $("#games").innerHTML = shown.map(game => {
        const date = new Date(game.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric"
        });

        const status = game.state === "pre"
            ? new Date(game.date).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short"
            })
            : game.status;

        const winner = game.winner ? team(game.winner) : null;

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
                    series.games.filter(g => g.completed).at(-1)?.id === game.id
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
            ? owner.roster.map(t => `
            <div class="roster-row">
              <span class="pick-number">
                ${picks.findIndex(p => p.team === t.id) + 1}
              </span>

              ${logo(t)}

              <div>
                ${escape(t.name)}
                <span class="team-meta">
                  ${t.wins}–${t.losses} ·
                  ${fmt(t.regular)} regular +
                  ${fmt(t.entry + t.series + t.conference)} postseason
                </span>
              </div>

              <span class="points">${fmt(t.total)}</span>
            </div>
          `).join("")
            : '<div class="empty">Your first pick is waiting.</div>'}
    </article>
  `).join("");

    $("#all-team-rows").innerHTML = [...state.scored.teams]
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        .map(t => `
      <tr>
        <td>${escape(t.name)} ${dot(t.id)}</td>
        <td>${t.wins}–${t.losses}</td>
        <td>${fmt(t.regular)}</td>
        <td>${fmt(t.entry)}</td>
        <td>${fmt(t.series)}</td>
        <td>${fmt(t.conference)}</td>
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
        const snapshot = await fetchJSON(`data/seasons/${year}.json`);

        if (snapshot.schemaVersion !== 1 || snapshot.season !== year) {
            throw new Error("Unexpected season data");
        }

        let live = false;

        if (year === state.index.currentSeason && !snapshot.complete) {
            try {
                const dates = [
                    dateCode(new Date()),
                    dateCode(new Date(Date.now() - 86400000))
                ];

                const results = await Promise.all(
                    dates.map(date => fetchJSON(`${FEED}?dates=${date}`))
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

                snapshot.games = mergeGames(snapshot.games, additions);

                scoreSeason(state.teams, snapshot.games, snapshot.clinched);
                live = true;
            } catch {
                // Saved season data remains available if live refresh fails.
            }
        }

        scoreSeason(state.teams, snapshot.games, snapshot.clinched);
        state.snapshot = snapshot;

        notice("");
        render();

        const saved = new Date(snapshot.updatedAt);
        const old = Date.now() - saved.getTime() > 2 * 3600000;

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
            year === state.index.currentSeason &&
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

function suggestedOwner() {
    const pickCount = draft().length;
    const snake = [0, 1, 1, 0];

    return state.league.owners[snake[pickCount % 4]].id;
}

function renderDraft() {
    const picks = draft();

    $("#draft-season").textContent =
        `${state.snapshot.label} SEASON DRAFT`;

    $("#owner-buttons").innerHTML = state.league.owners.map(owner => `
    <button
      data-owner="${escape(owner.id)}"
      aria-pressed="${state.owner === owner.id}"
    >
      ${escape(owner.name)} ·
      ${picks.filter(p => p.owner === owner.id).length}/15
    </button>
  `).join("");

    $("#draft-progress").textContent =
        `${picks.length} of 30 teams drafted · ` +
        `Next pick: ${picks.length + 1} · Suggested order: snake draft`;

    $("#undo-pick").disabled = !picks.length;

    const query = $("#team-search").value.toLowerCase();
    const ownerCount = picks.filter(p => p.owner === state.owner).length;

    $("#draft-teams").innerHTML = state.teams
        .filter(t => `${t.name} ${t.abbr}`.toLowerCase().includes(query))
        .map(t => {
            const pick = picks.find(p => p.team === t.id);

            const label = pick
                ? `${picks.indexOf(pick) + 1}. ${escape(state.league.owners.find(o => o.id === pick.owner).name)
                }`
                : `${t.conference} · ${t.abbr}`;

            return `
        <button
          class="draft-team"
          data-team="${t.id}"
          ${pick || ownerCount >= 15 ? "disabled" : ""}
        >
          ${logo(t)}
          <span>
            ${escape(t.shortName)}
            <small>${label}</small>
          </span>
        </button>
      `;
        }).join("");
}

function openDraft() {
    if (!state.snapshot) return;

    state.owner = suggestedOwner();
    $("#draft-message").textContent = "";

    renderDraft();
    $("#draft-dialog").showModal();
}

function validateLeague(value) {
    if (
        !value ||
        !Array.isArray(value.owners) ||
        value.owners.length !== 2 ||
        !value.drafts ||
        typeof value.drafts !== "object" ||
        Array.isArray(value.drafts)
    ) {
        throw new Error("Expected two owners and a drafts object");
    }

    const ids = new Set();

    for (const owner of value.owners) {
        if (
            typeof owner.id !== "string" ||
            !/^[a-z0-9_-]{1,30}$/i.test(owner.id) ||
            ids.has(owner.id) ||
            typeof owner.name !== "string" ||
            !owner.name.trim() ||
            owner.name.length > 35 ||
            !/^#[0-9a-f]{6}$/i.test(owner.color)
        ) {
            throw new Error("Invalid owner details");
        }

        ids.add(owner.id);
    }

    for (const [year, picks] of Object.entries(value.drafts)) {
        if (!/^20\d{2}$/.test(year)) {
            throw new Error("Invalid season year");
        }

        validateDraft(picks, state.teams, value.owners);

        for (const owner of value.owners) {
            if (picks.filter(p => p.owner === owner.id).length > 15) {
                throw new Error("Each owner can draft at most 15 teams");
            }
        }
    }

    return value;
}

$("#series-result").addEventListener("change", renderCalculator);
$("#conference-check").addEventListener("change", renderCalculator);
window.addEventListener("hashchange", navigate);

$("#refresh").addEventListener("click", () => refresh());

$("#season").addEventListener("change", async event => {
    if (state.busy) {
        event.target.value = String(state.year);
        return;
    }

    const previousYear = state.year;
    const previousSnapshot = state.snapshot;

    state.year = Number(event.target.value);
    state.snapshot = null;

    notice("Loading season…");

    const ok = await refresh(true);

    if (!ok) {
        state.year = previousYear;
        state.snapshot = previousSnapshot;
        event.target.value = String(previousYear);

        if (previousSnapshot) render();

        notice(
            "That season could not be loaded. Showing the previous season.",
            true
        );
    }
});

$$("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        state.filter = button.dataset.filter;

        $$("[data-filter]").forEach(other => {
            other.setAttribute("aria-pressed", String(other === button));
        });

        if (state.snapshot) renderGames();
    });
});

$("#open-draft").addEventListener("click", openDraft);
$("#teams-draft").addEventListener("click", openDraft);

$("#close-draft").addEventListener("click", () => {
    $("#draft-dialog").close();
});

$("#owner-buttons").addEventListener("click", event => {
    const button = event.target.closest("[data-owner]");

    if (button) {
        state.owner = button.dataset.owner;
        renderDraft();
    }
});

$("#team-search").addEventListener("input", renderDraft);

$("#draft-teams").addEventListener("click", event => {
    const button = event.target.closest("[data-team]");

    if (!button || button.disabled) return;

    try {
        saveDraft([
            ...draft(),
            { team: button.dataset.team, owner: state.owner }
        ]);

        state.owner = suggestedOwner();

        notice("");
        renderDraft();
        render();
    } catch (error) {
        $("#draft-message").textContent = error.message;
    }
});

$("#undo-pick").addEventListener("click", () => {
    try {
        saveDraft(draft().slice(0, -1));
        state.owner = suggestedOwner();

        renderDraft();
        render();
    } catch (error) {
        $("#draft-message").textContent = error.message;
    }
});

$("#published-draft").addEventListener("click", () => {
    try {
        localStorage.removeItem(storageKey(state.year));
        state.owner = suggestedOwner();

        renderDraft();
        notice("");
        render();

        $("#draft-message").textContent =
            "Now using the published rosters.";
    } catch (error) {
        $("#draft-message").textContent = error.message;
    }
});

$("#export-draft").addEventListener("click", () => {
    const config = structuredClone(state.league);

    for (const info of state.index.seasons) {
        try {
            const picks = JSON.parse(
                localStorage.getItem(storageKey(info.year))
            );

            if (picks) {
                config.drafts[String(info.year)] = validateDraft(
                    picks,
                    state.teams,
                    config.owners
                );
            }
        } catch { }
    }

    config.drafts[String(state.year)] = draft();

    const blob = new Blob(
        [JSON.stringify(config, null, 2) + "\n"],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "league.json";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    $("#draft-message").textContent =
        "Downloaded. Replace league.json in the root of your GitHub repository " +
        "to publish the rosters.";
});

$("#import-draft").addEventListener("change", async event => {
    try {
        const file = event.target.files[0];

        if (!file) return;
        if (file.size > 100000) throw new Error("Draft file is too large");

        const config = validateLeague(JSON.parse(await file.text()));

        if (
            config.owners.some(
                (owner, index) => owner.id !== state.league.owners[index].id
            )
        ) {
            throw new Error("Owner IDs must match this league");
        }

        const picks = config.drafts[String(state.year)];

        if (!picks) {
            throw new Error("This file does not include the selected season");
        }

        saveDraft(picks);
        state.owner = suggestedOwner();

        notice("");
        renderDraft();
        render();

        $("#draft-message").textContent =
            "Draft imported on this device.";
    } catch (error) {
        $("#draft-message").textContent = error.message;
    }

    event.target.value = "";
});

async function init() {
    try {
        const [teams, index, league] = await Promise.all([
            fetchJSON("data/teams.json"),
            fetchJSON("data/index.json"),
            fetchJSON("league.json")
        ]);

        state.teams = teams;
        state.league = validateLeague(league);
        state.index = index;
        state.year = index.currentSeason;

        $("#season").innerHTML = index.seasons.map(season => `
      <option
        value="${season.year}"
        ${season.year === state.year ? "selected" : ""}
      >
        ${escape(season.label)}${season.complete ? " · Final" : ""}
      </option>
    `).join("");

        document.title =
            `${league.title || league.owners.map(o => o.name).join(" vs. ")} ` +
            "| NBA Fantasy Draft";

        await refresh(true);

        setInterval(() => {
            if (!document.hidden && !$("#draft-dialog").open) {
                refresh();
            }
        }, 60000);

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && !$("#draft-dialog").open) {
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