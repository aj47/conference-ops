import assert from "node:assert/strict";
import worker, { notice } from "./index.mjs";

const landing = await worker.fetch(new Request("https://example.test/"));
assert.equal(landing.status, 200);
const landingHtml = await landing.text();
const landingText = landingHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
assert.ok(landingText.includes(notice));
assert.equal(landing.headers.get("x-robots-tag"), "noindex, nofollow");

const retiredApi = await worker.fetch(new Request("https://example.test/api/ready"));
assert.equal(retiredApi.status, 410);
assert.match(await retiredApi.text(), /hi@techfren\.net/);

const robots = await worker.fetch(new Request("https://example.test/robots.txt"));
assert.equal(robots.status, 200);
assert.match(robots.headers.get("content-type") ?? "", /^text\/plain/);
assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");

const head = await worker.fetch(new Request("https://example.test/", { method: "HEAD" }));
assert.equal(head.status, 200);
assert.equal(await head.text(), "");

console.log("maintenance worker checks passed");
