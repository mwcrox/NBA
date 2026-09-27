import { validateDraft } from './scoring.mjs';

// Shared by the website and updater. Only this file-backed configuration is used.
export function parseLeague(config, teams) {
    if (
        !config ||
        !Number.isInteger(config.season) ||
        config.season < 2025 ||
        config.season > 2100
    ) {
        throw new Error(
            'league.json must specify the season ending year, e.g. 2027.'
        );
    }

    if (!Array.isArray(config.owners) || config.owners.length !== 2) {
        throw new Error('league.json must contain exactly two owners.');
    }

    const ownerIds = new Set();

    for (const owner of config.owners) {
        if (
            !owner ||
            typeof owner.id !== 'string' ||
            !/^[a-z0-9_-]{1,30}$/i.test(owner.id) ||
            ownerIds.has(owner.id) ||
            typeof owner.name !== 'string' ||
            !owner.name.trim() ||
            owner.name.length > 35 ||
            !/^#[0-9a-f]{6}$/i.test(owner.color)
        ) {
            throw new Error('Invalid or duplicate owner in league.json.');
        }

        ownerIds.add(owner.id);
    }

    if (
        !config.rosters ||
        typeof config.rosters !== 'object' ||
        Array.isArray(config.rosters) ||
        Object.keys(config.rosters).some(id => !ownerIds.has(id))
    ) {
        throw new Error(
            'Rosters must be keyed by the owner IDs in league.json.'
        );
    }

    const byCode = new Map(
        teams.map(team => [team.abbr.toUpperCase(), team])
    );

    const aliases = {
        GSW: 'GS',
        NYK: 'NY',
        NOP: 'NO',
        SAS: 'SA',
        UTA: 'UTAH',
        WAS: 'WSH'
    };

    const picks = [];

    for (const owner of config.owners) {
        const roster = config.rosters[owner.id];

        if (!Array.isArray(roster) || roster.length > 15) {
            throw new Error(
                `${owner.name}'s roster must be an array of at most 15 team abbreviations.`
            );
        }

        for (const value of roster) {
            if (typeof value !== 'string') {
                throw new Error(
                    'Use team abbreviations such as BOS in each roster.'
                );
            }

            const code = value.trim().toUpperCase();
            const team = byCode.get(aliases[code] || code);

            if (!team) {
                throw new Error(
                    `Unknown team abbreviation in league.json: ${value}`
                );
            }

            picks.push({
                team: team.id,
                owner: owner.id
            });
        }
    }

    validateDraft(picks, teams, config.owners);

    return {
        ...config,
        picks
    };
}