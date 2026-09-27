import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    FEED,
    currentSeason,
    seasonKey,
    normalizeEvent,
    mergeGames,
    scoreSeason
} from "../assets/scoring.mjs";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const read = async filename => JSON.parse(
    await fs.readFile(path.join(root, filename), "utf8")
);

async function json(url) {
    let error;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(30000),
                headers: { Accept: "application/json" }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} for ${url}`);
            }

            return await response.json();
        } catch (err) {
            error = err;

            if (attempt < 2) {
                await new Promise(resolve => {
                    setTimeout(resolve, 1000 * (attempt + 1));
                });
            }
        }
    }

    throw error;
}

async function pool(items, fn) {
    const output = [];
    let index = 0;

    await Promise.all(
        Array.from({ length: 4 }, async () => {
            while (index < items.length) {
                const i = index++;
                output[i] = await fn(items[i]);
            }
        })
    );

    return output;
}

async function atomic(filename, object) {
    const destination = path.join(root, filename);

    await fs.mkdir(path.dirname(destination), { recursive: true });

    await fs.writeFile(
        destination + ".tmp",
        JSON.stringify(object) + "\n"
    );

    await fs.rename(destination + ".tmp", destination);
}

async function build(year, teams) {
    const months = [
        ...Array.from(
            { length: 3 },
            (_, i) => `${year - 1}${i + 10}`
        ),
        ...Array.from(
            { length: 6 },
            (_, i) => `${year}0${i + 1}`
        )
    ];

    const responses = await pool(months, async month => {
        const result = await json(
            `${FEED}?dates=${month}&limit=1000`
        );

        if (
            !Array.isArray(result.events) ||
            result.events.length >= 1000
        ) {
            throw new Error(`Missing or truncated ${month} schedule`);
        }

        return result.events
            .map(normalizeEvent)
            .filter(event =>
                event &&
                event.year === year &&
                event.phase !== "excluded"
            );
    });

    const games = mergeGames(...responses);

    const standings = await json(
        "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings" +
        `?season=${year}&seasontype=2`
    );

    const entries = (standings.children || []).flatMap(
        conference => conference.standings?.entries || []
    );

    const stats = entry => Object.fromEntries(
        entry.stats.map(stat => [stat.name, stat])
    );

    // Only explicit playoff/division/conference clinches qualify.
    // A play-in berth alone is not a playoff berth.
    const clinched = Number(standings.season?.year) === year
        ? entries.filter(entry => {
            const description = stats(entry).clincher?.description || "";

            return (
                /clinched.*(?:playoff|division|conference)/i.test(description) &&
                !/play.in/i.test(description)
            );
        }).map(entry => String(entry.team.id))
        : [];

    const scored = scoreSeason(teams, games, clinched);
    const now = new Date();

    const alreadyStarted =
        now >= new Date(`${year - 1}-11-01T00:00:00Z`);

    if (alreadyStarted && !games.some(game => game.completed)) {
        throw new Error(
            `No completed games returned for ${seasonKey(year)}`
        );
    }

    if (
        Number(standings.season?.year) === year &&
        entries.length === 30
    ) {
        const expected = entries.reduce(
            (sum, entry) => sum + Number(stats(entry).wins?.value || 0),
            0
        );

        const actual = scored.totals.regular * 2;

        // Allow short feed delays, but reject substantial missing coverage.
        if (Math.abs(expected - actual) > 15) {
            throw new Error(
                `Schedule/standings mismatch: ${actual} vs ${expected} wins`
            );
        }
    }

    let previous;

    try {
        previous = await read(`data/seasons/${year}.json`);
    } catch { }

    if (
        previous &&
        games.length < previous.games.length - 15
    ) {
        throw new Error("Unexpected loss of schedule coverage");
    }

    const complete = scored.series.some(
        series => series.round === 4 && series.winner
    );

    if (
        complete &&
        (
            scored.totals.regular !== 615 ||
            scored.totals.entry !== 112 ||
            scored.totals.series !== 105 ||
            scored.totals.conference !== 20
        )
    ) {
        throw new Error(
            `Incomplete finished season: ${JSON.stringify(scored.totals)}`
        );
    }

    const snapshot = {
        schemaVersion: 1,
        season: year,
        label: seasonKey(year),
        updatedAt: now.toISOString(),
        source: "ESPN",
        complete,
        clinched,
        games
    };

    await atomic(`data/seasons/${year}.json`, snapshot);

    console.log(
        `${snapshot.label}: ${games.length} games; ` +
        `${scored.totals.total} points; ` +
        `${complete ? "complete" : "tracking"}`
    );

    return {
        year,
        label: snapshot.label,
        complete
    };
}

const teams = await read("data/teams.json");

let index;

try {
    index = await read("data/index.json");
} catch {
    index = { seasons: [] };
}

const explicit = process.argv.slice(2).map(Number);

if (
    explicit.some(year =>
        !Number.isInteger(year) ||
        year < 2025 ||
        year > 2100
    )
) {
    throw new Error(
        "Pass season END years, e.g. 2027 for 2026-27"
    );
}

const current = currentSeason();

const years = explicit.length
    ? explicit
    : [
        current,
        ...index.seasons
            .filter(season => !season.complete && season.year < current)
            .map(season => season.year)
    ];

for (const year of [...new Set(years)]) {
    const info = await build(year, teams);

    index.seasons = index.seasons.filter(
        season => season.year !== year
    );

    index.seasons.push(info);
}

index.seasons.sort((a, b) => b.year - a.year);

index.currentSeason = index.seasons.some(
    season => season.year === current
)
    ? current
    : index.seasons[0].year;

index.updatedAt = new Date().toISOString();

await atomic("data/index.json", index);