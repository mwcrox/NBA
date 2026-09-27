import test from "node:test";
import assert from "node:assert/strict";

import {
    scoreSeason,
    seriesAllocation,
    normalizeEvent,
    mergeGames,
    validateDraft,
    ownerScores,
    currentSeason
} from "../assets/scoring.mjs";

const teams = [
    { id: "1", name: "A", conference: "East" },
    { id: "2", name: "B", conference: "East" },
    { id: "3", name: "C", conference: "West" }
];

function game(
    id,
    winner,
    {
        phase = "playoff",
        round = 1,
        completed = true
    } = {}
) {
    return {
        id: String(id),
        date: `2025-05-${String(id).padStart(2, "0")}T20:00:00Z`,
        phase,
        round,
        completed,
        winner: completed ? winner : null,
        sides: [
            { id: "1" },
            { id: "2" }
        ]
    };
}

test("all best-of-seven outcomes preserve seven points", () => {
    for (let loss = 0; loss < 4; loss++) {
        assert.deepEqual(
            seriesAllocation(4, loss),
            [7 - loss, loss]
        );

        assert.deepEqual(
            seriesAllocation(loss, 4),
            [loss, 7 - loss]
        );
    }

    assert.deepEqual(
        seriesAllocation(2, 1),
        [2, 1]
    );

    assert.throws(
        () => seriesAllocation(4, 4)
    );
});

test("4–2 conference title includes separate 10-point bonus", () => {
    const games = [1, 1, 2, 1, 2, 1].map(
        (winner, index) =>
            game(
                index + 1,
                String(winner),
                { round: 3 }
            )
    );

    const result = scoreSeason(teams, games);

    assert.equal(result.series[0].conference, "East");
    assert.equal(result.teams[0].series, 5);
    assert.equal(result.teams[1].series, 2);
    assert.equal(result.teams[0].conference, 10);
    assert.equal(result.teams[0].entry, 7);
    assert.equal(result.teams[0].total, 22);
});

test("regular wins, duplicate IDs and uncompleted games", () => {
    const final = game(
        1,
        "1",
        { phase: "regular" }
    );

    const result = scoreSeason(teams, [
        final,
        final,
        game(
            2,
            "1",
            {
                phase: "regular",
                completed: false
            }
        )
    ]);

    assert.equal(result.totals.total, 0.5);
    assert.equal(result.teams[1].losses, 1);
});

test("partial series awards no unplayed points or title bonus", () => {
    const games = [1, 1, 1].map(
        (winner, index) =>
            game(
                index + 1,
                String(winner),
                { round: 3 }
            )
    );

    const result = scoreSeason(teams, games);

    assert.equal(result.teams[0].series, 3);
    assert.equal(result.teams[0].conference, 0);
});

test("entry awarded once and Finals has no extra title bonus", () => {
    const games = [1, 2, 3, 4].flatMap(round =>
        [1, 2, 3, 4].map((_, index) => ({
            ...game(
                round * 5 + index,
                "1",
                { round }
            ),
            date: "2025-05-01T00:00:00Z"
        }))
    );

    const result = scoreSeason(teams, games);

    assert.equal(result.teams[0].entry, 7);
    assert.equal(result.teams[0].series, 28);
    assert.equal(result.teams[0].conference, 10);
    assert.equal(result.teams[0].total, 45);
});

test("corrections replace a result rather than adding it", () => {
    const original = game(
        1,
        "1",
        { phase: "regular" }
    );

    const corrected = {
        ...original,
        winner: "2"
    };

    const result = scoreSeason(
        teams,
        mergeGames([original], [corrected])
    );

    assert.equal(result.teams[0].total, 0);
    assert.equal(result.teams[1].total, 0.5);
});

const event = (
    type,
    competition = "1",
    note = ""
) => ({
    id: "100",
    date: "2025-04-01T00:00Z",
    season: {
        year: 2025,
        type
    },
    competitions: [
        {
            type: {
                id: competition
            },
            notes: [
                { headline: note }
            ],
            competitors: [
                {
                    id: "1",
                    team: {},
                    score: "110",
                    winner: true
                },
                {
                    id: "2",
                    team: {},
                    score: "100"
                }
            ],
            status: {
                type: {
                    name: "STATUS_FINAL",
                    completed: true,
                    state: "post"
                }
            }
        }
    ]
});

test("excludes non-scoring games and counts Cup semifinals", () => {
    const excluded = [
        event(5),
        event(2, "4", "NBA All-Star"),
        event(1),
        event(2, "39", "NBA Cup Championship"),
        event(3, "1", "NBA Play-In")
    ];

    for (const item of excluded) {
        assert.equal(
            normalizeEvent(item).phase,
            "excluded"
        );
    }

    assert.equal(
        normalizeEvent(
            event(2, "38", "NBA Cup Semifinal")
        ).phase,
        "regular"
    );
});

test("identifies playoff rounds and rejects unknown format", () => {
    [14, 15, 16, 17].forEach((id, index) => {
        assert.equal(
            normalizeEvent(
                event(3, String(id))
            ).round,
            index + 1
        );
    });

    assert.throws(
        () => normalizeEvent(event(3, "999"))
    );
});

test("canceled games cannot earn a win", () => {
    const item = event(2);

    item.competitions[0].status.type = {
        name: "STATUS_CANCELED",
        completed: true,
        state: "post"
    };

    assert.equal(
        normalizeEvent(item).completed,
        false
    );
});

test("scheduled playoff participants qualify before game one", () => {
    const result = scoreSeason(
        teams,
        [
            game(
                1,
                null,
                { completed: false }
            )
        ]
    );

    assert.equal(result.totals.entry, 14);
    assert.equal(result.totals.series, 0);
});

test("draft validation prevents double counting", () => {
    const owners = [
        { id: "m" },
        { id: "z" }
    ];

    const picks = [
        { team: "1", owner: "m" }
    ];

    validateDraft(picks, teams, owners);

    assert.throws(() =>
        validateDraft(
            [...picks, ...picks],
            teams,
            owners
        )
    );

    assert.throws(() =>
        validateDraft(
            [{ team: "x", owner: "m" }],
            teams,
            owners
        )
    );

    const scored = scoreSeason(
        teams,
        [
            game(
                1,
                "1",
                { phase: "regular" }
            )
        ]
    );

    assert.equal(
        ownerScores(
            scored,
            picks,
            owners
        )[0].total,
        0.5
    );
});

test("season rolls over in July using its ending year", () => {
    assert.equal(
        currentSeason(
            new Date("2027-06-30T12:00Z")
        ),
        2027
    );

    assert.equal(
        currentSeason(
            new Date("2027-07-01T12:00Z")
        ),
        2028
    );
});

test("TBD slots cannot qualify phantom playoff teams", () => {
    const item = event(3, "14");

    item.competitions[0].competitors[0].id = "-1";

    assert.equal(
        normalizeEvent(item),
        null
    );
});