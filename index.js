import cron from 'node-cron';

const hikkaApi = Bun.env.HIKKA_API_URL;
const hikkaUsername = Bun.env.HIKKA_USERNAME;
const anilistToken = Bun.env.ANILIST_IMPLICIT_AUTH;

const getHikkaUserHistory = async (username) => {
    const response = await fetch(`${hikkaApi}/history/user/${username}?page=1&limit=100`);
    const { _, list } = await response.json();

    const filteredWatch = list.filter(item => item.history_type === 'watch');
    const filteredNewest = new Map();

    filteredWatch.forEach(item => {
        const { content: { slug } } = item;

        if (!filteredNewest.has(slug) || filteredNewest.get(slug).updated < item.updated) {
            filteredNewest.set(slug, item);
        }
    });

    const parsedWatch = Array.from(filteredNewest.values()).map(item => {
        const {
            content: { slug },
            data: { after }
        } = item;

        return {
            slug,
            after
        };
    });

    return parsedWatch;
}

const getMalIdByHikkaSlug = async (slug) => {
    const response = await fetch(`${hikkaApi}/anime/${slug}`);
    const { mal_id } = await response.json();

    return mal_id;
}

const getAnilistEntryByMalId = async (malId) => {
    const response = await fetch(`https://graphql.anilist.co`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anilistToken}`
        },
        body: JSON.stringify({
            query: `
                query ($malId: Int) {
                    Media(idMal: $malId, type: ANIME) {
                        id
                        siteUrl
                        mediaListEntry {
                            status
                            score
                            progress
                            repeat
                        }
                    }
                }
            `,
            variables: {
                malId
            }
        })
    });

    const { data: { Media } } = await response.json();

    return Media;
}

const setAnilistEntry = async (anilistId, entry) => {
    if (entry.progress >= 0 && entry?.status !== 'COMPLETED') entry.status = 'CURRENT';

    console.log(`Setting ${anilistId} to ${entry.status} with data:\n`, entry)

    const response = await fetch(`https://graphql.anilist.co`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anilistToken}`
        },
        body: JSON.stringify({
            query: `
                mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int, $repeat: Int) {
                    SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress, repeat: $repeat) {
                        id
                    }
                }
            `,
            variables: {
                mediaId: anilistId,
                ...entry
            }
        })
    });

    const res = await response.json();

    if (res.errors) console.error(res.errors);

    return res;
}

const compareEntries = (hikkaEntry, anilistEntry) => {
    const { after: hikka } = hikkaEntry;
    const { mediaListEntry: anilist } = anilistEntry;

    const normalizeHikka = (hikka) => {
        switch (hikka.status) {
            case 'completed': hikka.status = 'COMPLETED'; break;
            case 'watching': hikka.status = 'CURRENT'; break;
            case 'on_hold': hikka.status = 'PAUSED'; break;
            case 'dropped': hikka.status = 'DROPPED'; break;
            case 'planned': hikka.status = 'PLANNING'; break;
        }

        return {
            status: hikka.status,
            score: hikka.score,
            progress: hikka.episodes,
            repeat: hikka.rewatches
        }
    }

    const removeUndefinedFields = obj => Object.fromEntries(Object.entries(obj).filter(([key, value]) => value !== undefined));

    const normalizedHikka = normalizeHikka(hikka);

    if (!anilist) return removeUndefinedFields(normalizedHikka);

    const difference = {};

    for (let key in normalizedHikka) {
        if (normalizedHikka.hasOwnProperty(key) && anilist.hasOwnProperty(key)) {
            if (normalizedHikka[key] !== anilist[key]) {
                difference[key] = normalizedHikka[key]
            }
        }
    }

    return removeUndefinedFields(difference);
}

const sync = async () => {
    const hikkahistory = await getHikkaUserHistory(hikkaUsername);

    for (const entry of hikkahistory) {
        const { slug } = entry;
        const malId = await getMalIdByHikkaSlug(slug);
        const anilistEntry = await getAnilistEntryByMalId(malId);

        if (!anilistEntry) {
            console.error(`No Anilist entry for ${slug}`);
            continue;
        }

        const init = anilistEntry.mediaListEntry;
        const diff = compareEntries(entry, anilistEntry);

        if (
            Object.keys(diff).length > 0 &&
            !(entry?.after?.status === anilistEntry?.mediaListEntry.status)
        ) await setAnilistEntry(anilistEntry.id, { ...init, ...diff });
        else console.log(`No changes for ${anilistEntry.siteUrl}`);

        await Bun.sleep(3000);
    }
}

console.log('Running sync at:', new Date().toISOString());
sync();
cron.schedule('0 * * * *', () => {
    console.log('Running sync at:', new Date().toISOString());
    sync();
});