import assert from "node:assert/strict";
import test from "node:test";
import { advanceQueue } from "./playback-queue.ts";

const order = ["a", "b", "c"];

test("a finished song advances to the next item in the queue", () => {
  const next = advanceQueue({ order, trackId: "a", repeat: "off", shuffle: false, heard: [], related: ["z"] });
  assert.deepEqual(next, { type: "play", id: "b", heard: [], radio: false });
});

test("repeat one restarts the same song", () => {
  assert.equal(
    advanceQueue({ order, trackId: "b", repeat: "one", shuffle: false, heard: [], related: [] }).type,
    "restart",
  );
});

test("repeat all wraps to the first song", () => {
  const next = advanceQueue({ order, trackId: "c", repeat: "all", shuffle: false, heard: [], related: ["z"] });
  assert.deepEqual(next, { type: "play", id: "a", heard: [], radio: false });
});

test("repeat off continues into related tracks when the queue ends", () => {
  const next = advanceQueue({ order, trackId: "c", repeat: "off", shuffle: false, heard: [], related: ["z", "y"] });
  assert.deepEqual(next, { type: "play", id: "z", heard: [], radio: true });
});

test("repeat off stops when nothing related is left", () => {
  assert.equal(
    advanceQueue({ order, trackId: "c", repeat: "off", shuffle: false, heard: [], related: [] }).type,
    "stop",
  );
});

test("an empty queue starts related music", () => {
  const next = advanceQueue({ order: [], trackId: "solo", repeat: "off", shuffle: false, heard: [], related: ["z"] });
  assert.equal(next.type, "play");
  if (next.type === "play") assert.equal(next.radio, true);
});

test("shuffle does not repeat a song until the queue is exhausted", () => {
  const first = advanceQueue({
    order,
    trackId: "a",
    repeat: "off",
    shuffle: true,
    heard: [],
    related: ["z"],
    rng: () => 0,
  });
  assert.equal(first.type, "play");
  if (first.type !== "play") return;
  assert.equal(first.id, "b");
  const second = advanceQueue({
    order,
    trackId: first.id,
    repeat: "off",
    shuffle: true,
    heard: first.heard,
    related: ["z"],
    rng: () => 0,
  });
  assert.equal(second.type, "play");
  if (second.type !== "play") return;
  assert.equal(second.id, "c");
  const radio = advanceQueue({
    order,
    trackId: second.id,
    repeat: "off",
    shuffle: true,
    heard: second.heard,
    related: ["z"],
    rng: () => 0,
  });
  assert.deepEqual(radio, { type: "play", id: "z", heard: [], radio: true });
});

test("a song that is not in the queue starts at the front of it", () => {
  const next = advanceQueue({ order, trackId: "other", repeat: "off", shuffle: false, heard: [], related: [] });
  assert.equal(next.type, "play");
  if (next.type === "play") assert.equal(next.id, "a");
});
