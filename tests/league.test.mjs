import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseLeague } from '../assets/league.mjs';

import {
    scoreSeason,
    ownerScores
} from '../assets/scoring.mjs';

const teams = JSON.parse(
    fs.readFileSync(
        new URL('../data/teams.json', import.meta.url)
    )
);

const published = JSON.parse(
    fs.readFileSync(
        new URL('../league.json', import.meta.url)
    )
);

const config = () => ({
    ...structuredClone(published),
    rosters: {
        michael: [],
        zach: []
    }
});

test('published league configuration is valid', () => {
    assert.equal(
        parseLeague(published, teams).season,
        published.season
    );
});

test('empty rosters produce no invented picks', () => {
    assert.deepEqual(
        parseLeague(config(), teams).picks,
        []
    );
});

test('team codes become correctly assigned team IDs in roster order', () => {
    const c = config();

    c.rosters = {
        michael: ['BOS', 'DEN'],
        zach: ['LAL', 'NY']
    };

    assert.deepEqual(
        parseLeague(c, teams).picks,
        [
            { team: '2', owner: 'michael' },
            { team: '7', owner: 'michael' },
            { team: '13', owner: 'zach' },
            { team: '18', owner: 'zach' }
        ]
    );
});

test('duplicate teams are rejected within and across rosters', () => {
    const c = config();

    c.rosters.michael = ['BOS', 'BOS'];

    assert.throws(
        () => parseLeague(c, teams),
        /only once/
    );

    c.rosters = {
        michael: ['BOS'],
        zach: ['BOS']
    };

    assert.throws(
        () => parseLeague(c, teams),
        /only once/
    );
});

test('invalid abbreviations, unknown owners and oversized rosters are rejected', () => {
    const c = config();

    c.rosters.michael = ['NOTATEAM'];

    assert.throws(
        () => parseLeague(c, teams),
        /Unknown team/
    );

    c.rosters.michael = teams
        .slice(0, 16)
        .map(t => t.abbr);

    assert.throws(
        () => parseLeague(c, teams),
        /at most 15/
    );

    c.rosters = {
        michael: [],
        zach: [],
        typo: []
    };

    assert.throws(
        () => parseLeague(c, teams),
        /owner IDs/
    );
});

test('common NBA abbreviations and letter case normalize without duplication', () => {
    const c = config();

    c.rosters = {
        michael: [' gsw ', 'NYK', 'NOP'],
        zach: ['SAS', 'UTA', 'WAS']
    };

    assert.deepEqual(
        parseLeague(c, teams).picks.map(p => p.team),
        ['9', '18', '3', '24', '26', '27']
    );

    c.rosters.zach = ['GS'];

    assert.throws(
        () => parseLeague(c, teams),
        /only once/
    );
});

test('configured rosters control owner scores', () => {
    const c = config();

    c.rosters = {
        michael: ['BOS'],
        zach: ['LAL']
    };

    const league = parseLeague(c, teams);

    const games = [
        {
            id: 'test-game',
            date: '2027-01-01T00:00:00Z',
            phase: 'regular',
            completed: true,
            winner: '2',
            sides: [
                { id: '2' },
                { id: '13' }
            ]
        }
    ];

    const results = ownerScores(
        scoreSeason(teams, games),
        league.picks,
        league.owners
    );

    assert.equal(results[0].total, 0.5);
    assert.equal(results[1].total, 0);
});