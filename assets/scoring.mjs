/**
 * Shared by the browser, updater and tests.
 * Points are rebuilt from results, never incremented in storage.
 */

export const RULES = Object.freeze({
    regularWin: 0.5,
    playoffEntry: 7,
    seriesPool: 7,
    conferenceTitle: 10
});

export const ROUND_NAMES = {
    1: "First round",
    2: "Conference semifinals",
    3: "Conference finals",
    4: "NBA Finals"
};

export const FEED =
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

export function seasonKey(year) {
    return `${year - 1}-${String(year).slice(-2)}`;
}

export function currentSeason(date = new Date()) {
    return date.getUTCFullYear() + (date.getUTCMonth() >= 6 ? 1 : 0);
}

export function normalizeEvent(event) {
    const competition = event.competitions?.[0];

    if (!competition || competition.competitors?.length !== 2) {
        return null;
    }

    // Future Cup/playoff slots may not have actual teams assigned yet.
    if (
        competition.competitors.some(team =>
            Number(team.id) <= 0 || team.team?.displayName === "TBD"
        )
    ) {
        return null;
    }

    const notes = (competition.notes || [])
        .map(note => note.headline || "")
        .join(" ");

    const seasonType = Number(event.season?.type);
    const type = String(competition.type?.id || "");

    const text =
        `${notes} ${competition.type?.text || ""} ` +
        `${competition.type?.abbreviation || ""}`;

    let phase = "excluded";
    let round = 0;

    if (seasonType === 2) {
        phase = "regular";
    }

    if (seasonType === 3) {
        phase = "playoff";

        round = {
            "14": 1,
            "15": 2,
            "16": 3,
            "17": 4
        }[type] || (
                /1st Round|First Round/i.test(text) ? 1 :
                    /Semifinal/i.test(text) ? 2 :
                        /East Finals|West Finals|Conference Finals/i.test(text) ? 3 :
                            /NBA Finals/i.test(text) ? 4 :
                                0
            );

        if (!round && !/play.?in/i.test(text)) {
            throw new Error(
                `Unknown playoff round for ${event.id}: ${text}`
            );
        }
    }

    if (
        type === "4" ||
        /all.?star/i.test(text) ||
        seasonType === 5 ||
        /play.?in/i.test(text) ||
        type === "39" ||
        /(?:NBA Cup|In.Season Tournament).*Championship/i.test(text)
    ) {
        phase = "excluded";
    }

    const status = competition.status || event.status || {};
    const statusName = status.type?.name || "";

    const completed =
        status.type?.completed === true &&
        /^STATUS_FINAL/.test(statusName);

    const sides = competition.competitors.map(team => ({
        id: String(team.id),
        abbr: team.team?.abbreviation,
        name: team.team?.displayName,
        home: team.homeAway === "home",
        score: Number(team.score?.value ?? team.score ?? 0),
        winner: team.winner === true
    }));

    let winner = completed
        ? sides.find(team => team.winner)?.id
        : null;

    if (
        completed &&
        !winner &&
        sides[0].score !== sides[1].score
    ) {
        winner = [...sides]
            .sort((a, b) => b.score - a.score)[0].id;
    }

    if (completed && !winner && phase !== "excluded") {
        throw new Error(`Final game ${event.id} has no winner`);
    }

    return {
        id: String(event.id),
        date: event.date,
        year: Number(event.season?.year),
        phase,
        round,
        notes,
        sides,
        completed,
        winner,
        state: completed ? "post" : status.type?.state || "pre",
        status:
            status.type?.shortDetail ||
            status.type?.description ||
            "Scheduled"
    };
}

export function mergeGames(...lists) {
    const map = new Map();

    for (const list of lists) {
        for (const game of list || []) {
            if (game) map.set(game.id, game);
        }
    }

    return [...map.values()].sort(
        (a, b) =>
            a.date.localeCompare(b.date) ||
            a.id.localeCompare(b.id)
    );
}

export function seriesAllocation(a, b) {
    const valid = [a, b].every(
        value => Number.isInteger(value) && value >= 0 && value <= 4
    );

    if (!valid || (a === 4 && b === 4)) {
        throw new Error("Invalid best-of-seven score");
    }

    return [
        a + (a === 4 ? 7 - a - b : 0),
        b + (b === 4 ? 7 - a - b : 0)
    ];
}

export function scoreSeason(teams, inputGames, clinched = []) {
    const games = mergeGames(inputGames);

    const points = Object.fromEntries(
        teams.map(team => [
            team.id,
            {
                ...team,
                conferenceName: team.conference,
                wins: 0,
                losses: 0,
                regular: 0,
                entry: 0,
                series: 0,
                conference: 0,
                total: 0
            }
        ])
    );

    const groups = new Map();

    const qualified = new Set(
        clinched.filter(id => points[id])
    );

    for (const game of games) {
        if (game.phase === "excluded") continue;

        if (game.sides.some(side => !points[side.id])) {
            throw new Error(`Unknown NBA team in game ${game.id}`);
        }

        if (
            game.phase === "regular" &&
            game.completed &&
            game.winner
        ) {
            const winner = points[game.winner];

            winner.wins++;
            winner.regular += RULES.regularWin;

            const loser = game.sides.find(
                side => side.id !== game.winner
            );

            points[loser.id].losses++;
        }

        if (game.phase === "playoff") {
            for (const side of game.sides) {
                qualified.add(side.id);
            }

            const ids = game.sides
                .map(side => side.id)
                .sort((a, b) => Number(a) - Number(b));

            const key = `${game.round}:${ids.join("-")}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    round: game.round,
                    ids,
                    wins: [0, 0],
                    games: []
                });
            }

            const series = groups.get(key);
            series.games.push(game);

            if (game.completed && game.winner) {
                series.wins[ids.indexOf(game.winner)]++;
            }
        }
    }

    if (qualified.size > 16) {
        throw new Error("More than 16 playoff qualifiers");
    }

    for (const id of qualified) {
        points[id].entry = RULES.playoffEntry;
    }

    const series = [...groups.values()].sort(
        (a, b) => a.round - b.round || a.key.localeCompare(b.key)
    );

    for (const matchup of series) {
        matchup.awarded = seriesAllocation(...matchup.wins);

        matchup.winner = matchup.wins.includes(4)
            ? matchup.ids[matchup.wins.indexOf(4)]
            : null;

        const a = points[matchup.ids[0]].conferenceName;
        const b = points[matchup.ids[1]].conferenceName;

        matchup.conference = a === b ? a : "NBA";

        for (let i = 0; i < 2; i++) {
            points[matchup.ids[i]].series += matchup.awarded[i];
        }

        if (matchup.round === 3 && matchup.winner) {
            points[matchup.winner].conference += RULES.conferenceTitle;
        }
    }

    const totals = {
        regular: 0,
        entry: 0,
        series: 0,
        conference: 0,
        total: 0
    };

    for (const team of Object.values(points)) {
        team.total =
            team.regular +
            team.entry +
            team.series +
            team.conference;

        for (const key of Object.keys(totals)) {
            totals[key] += team[key];
        }
    }

    if (
        totals.regular > 615 ||
        totals.series > 105 ||
        totals.conference > 20
    ) {
        throw new Error("Season scoring exceeds expected league totals");
    }

    return {
        teams: Object.values(points),
        series,
        totals,
        qualified: [...qualified]
    };
}

export function validateDraft(draft, teams, owners) {
    if (!Array.isArray(draft)) {
        throw new Error("Draft must be a list of picks");
    }

    const seen = new Set();
    const allowed = new Set(teams.map(team => team.id));
    const ownerIds = new Set(owners.map(owner => owner.id));

    for (const pick of draft) {
        if (
            !allowed.has(pick.team) ||
            !ownerIds.has(pick.owner) ||
            seen.has(pick.team)
        ) {
            throw new Error(
                "Each NBA team can be drafted only once by a valid owner"
            );
        }

        seen.add(pick.team);
    }

    return draft;
}

export function ownerScores(scored, draft, owners) {
    validateDraft(draft, scored.teams, owners);

    const map = new Map(
        scored.teams.map(team => [team.id, team])
    );

    return owners.map(owner => {
        const roster = draft
            .filter(pick => pick.owner === owner.id)
            .map(pick => map.get(pick.team));

        const totals = Object.fromEntries(
            ["regular", "entry", "series", "conference", "total"]
                .map(key => [
                    key,
                    roster.reduce((sum, team) => sum + team[key], 0)
                ])
        );

        return {
            ...owner,
            roster,
            ...totals
        };
    });
}