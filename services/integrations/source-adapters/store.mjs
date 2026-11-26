import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, link, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { verifyFeed } from "./feed.mjs";

const issuerIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const versionPattern = /^(\d+)\.json$/;

export async function publishOnce(filename, data) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(filename), `.${basename(filename)}-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, filename);
  } finally {
    await unlink(temporary);
  }
}

const json = value => JSON.stringify(value, null, 2) + "\n";

export function createFeedStore(root, issuerKeys) {
  function issuerDirectory(issuerId) {
    if (!issuerIdPattern.test(issuerId) || !Object.hasOwn(issuerKeys, issuerId)) throw new Error("Unknown source issuer");
    return join(root, "feeds", issuerId);
  }

  async function latestVersion(issuerId) {
    const directory = issuerDirectory(issuerId);
    let versions;
    try { versions = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
    return versions.reduce((latest, entry) => {
      const parsed = entry.isFile() ? Number(versionPattern.exec(entry.name)?.[1]) : NaN;
      return Number.isSafeInteger(parsed) ? Math.max(latest, parsed) : latest;
    }, 0);
  }

  async function read(issuerId, feedVersion) {
    if (!Number.isSafeInteger(feedVersion) || feedVersion < 1) throw new Error("Invalid feed version");
    const file = join(issuerDirectory(issuerId), `${feedVersion}.json`);
    let feed;
    try { feed = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (feed.issuerId !== issuerId || feed.feedVersion !== feedVersion || !verifyFeed(feed, issuerKeys[issuerId])) {
      throw new Error("Stored source feed failed verification");
    }
    return feed;
  }

  async function latest(issuerId) {
    const version = await latestVersion(issuerId);
    return version > 0 ? read(issuerId, version) : null;
  }

  async function append(feed) {
    const directory = issuerDirectory(feed.issuerId);
    if (!verifyFeed(feed, issuerKeys[feed.issuerId])) throw new Error("Source feed failed verification");
    const previous = await latest(feed.issuerId);
    if (feed.feedVersion !== (previous?.feedVersion ?? 0) + 1 || (previous && feed.issuedAt <= previous.issuedAt)) {
      throw new Error("Append only requires the next feed version and a newer issue time");
    }
    try { await publishOnce(join(directory, `${feed.feedVersion}.json`), json(feed)); }
    catch (error) { if (error.code === "EEXIST") throw new Error("Feed version already stored"); throw error; }
  }

  return { read, latest, latestVersion, append };
}

export async function mirrorFeeds(source, mirror, issuerIds, throughVersion = Number.MAX_SAFE_INTEGER) {
  let recordsCopied = 0;
  for (const issuerId of issuerIds) {
    const max = Math.min(await source.latestVersion(issuerId), throughVersion);
    for (let next = (await mirror.latestVersion(issuerId)) + 1; next <= max; next++) {
      const feed = await source.read(issuerId, next);
      if (!feed) throw new Error("Source feed version is missing");
      await mirror.append(feed);
      recordsCopied++;
    }
  }
  return recordsCopied;
}
