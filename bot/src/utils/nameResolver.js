// utils/nameResolver.js
import { Collection } from "discord.js";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// cache: Map<guildId, Map<userId, { name: string, expires: number }>>
const cache = new Map();

/** Internal: get from cache if fresh */
function cacheGet(guildId, userId) {
    const g = cache.get(guildId);
    if (!g)
        return null;
    const hit = g.get(userId);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
        g.delete(userId);
        return null;
    }
    return hit.name;
}

/** Internal: write to cache */
function cacheSet(guildId, userId, name) {
    let g = cache.get(guildId);
    if (!g) {
        g = new Map();
        cache.set(guildId, g);
    }
    g.set(userId, { name, expires: Date.now() + CACHE_TTL_MS });
}

/** Internal: fetch (or cache) a Guild instance */
async function getGuild(client, guildId) {
    return (
        client.guilds.cache.get(guildId) ??
            (await client.guilds.fetch(guildId))
    );
}

/**
 * Resolve a member's per-server display name (nickname if set, else username).
 * Falls back to global display name / username if the member isn't in the guild.
 *
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<string>}
 */
export async function resolveMemberDisplayName(client, guildId, userId) {
    // Cache first
    const cached = cacheGet(guildId, userId);
    if (cached)
        return cached;

    // Try guild member
    try {
        const guild = await getGuild(client, guildId);
        let member =
            guild.members.cache.get(userId) ??
            (await guild.members.fetch(userId).catch(() => null));

        if (member) {
            // member.displayName is the per-guild nickname or username
            const name =
                member.displayName ??
                member.nickname ??
                member.user?.globalName ??
                member.user?.username ??
                `user:${userId}`;
            cacheSet(guildId, userId, name);
            return name;
        }
    } catch {
        // ignore—fall through to user fetch
    }

    // Fallback: fetch User (not guild-scoped)
    try {
        const user =
            client.users.cache.get(userId) ??
            (await client.users.fetch(userId).catch(() => null));
        if (user) {
            const name = user.globalName ?? user.username ?? `user:${userId}`;
            cacheSet(guildId, userId, name);
            return name;
        }
    } catch {
        // ignore
    }

    // Last resort
    const unknown = `Unknown user ${userId}`;
    cacheSet(guildId, userId, unknown);
    return unknown;
}

/**
 * Convenience: resolve a bunch at once. Returns Map<userId, name>.
 * Efficiently uses cache and fetches each missing member/user at most once.
 *
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string[]} userIds
 * @returns {Promise<Map<string,string>>}
 */
export async function resolveManyMemberDisplayNames(client, guildId, userIds) {
    const out = new Map();
    const missing = [];

    for (const id of new Set(userIds)) {
        const c = cacheGet(guildId, id);
        if (c) out.set(id, c);
        else missing.push(id);
    }
    if (missing.length === 0) return out;

    const guild = await getGuild(client, guildId);

    // Try fetch members (one-by-one; safe and simple)
    for (const id of missing) {
        let name = null;
        try {
            const member =
                guild.members.cache.get(id) ??
                (await guild.members.fetch(id).catch(() => null));
            if (member) {
                name =
                    member.displayName ??
                    member.nickname ??
                    member.user?.globalName ??
                    member.user?.username ??
                    `user:${id}`;
            }
        } catch {
            /* ignore */
        }

        if (!name) {
            try {
                const user =
                    client.users.cache.get(id) ??
                    (await client.users.fetch(id).catch(() => null));
                if (user) {
                    name = user.globalName ?? user.username ?? `user:${id}`;
                }
            } catch {
                /* ignore */
            }
        }

        name = name ?? `Unknown user ${id}`;
        cacheSet(guildId, id, name);
        out.set(id, name);
    }

    return out;
}

/**
 * Convenience for your transcript pipeline:
 * Adds `speaker_name` to each segment using speaker_id.
 *
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {{speaker_id?: string}[]} segments
 * @returns {Promise<Array>}
 */
export async function annotateSegmentsWithNames(client, guildId, segments) {
    const ids = segments
        .map(s => s.speaker_id)
        .filter(Boolean);
    const nameMap = await resolveManyMemberDisplayNames(client, guildId, ids);
    return segments.map(s => ({
        ...s,
        speaker_name: nameMap.get(s.speaker_id) ?? s.speaker_id ?? "unknown",
    }));
}
