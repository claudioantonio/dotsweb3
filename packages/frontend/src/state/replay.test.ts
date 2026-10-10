import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../engine-adapter";
import { A, B, ended, records } from "./__fixtures__";
import { buildFrames, verify } from "./replay";

const history = { matchId: "1", gridSize: 2, players: [A, B] as [string, string], moves: records, ended };

describe("replay driver", () => {
  it("produces one frame per move plus the empty board", () => {
    const r = buildFrames(history);
    expect(r.frames).toHaveLength(5);
    expect(r.frames[0].edges).toHaveLength(0);
    expect(r.frames[4].squares).toHaveLength(1);
    expect(r.divergence).toBeNull();
    expect(r.replayHash).toBeNull(); // TODO-engine
  });

  it("stops at the first divergence", () => {
    const bad = { ...history, moves: records.map((m) => (m.moveIndex === 2 ? { ...m, squaresClosed: 2 } : m)) };
    const r = buildFrames(bad);
    expect(r.frames).toHaveLength(3);
    expect(r.divergence?.moveIndex).toBe(2);
  });
});

describe("verify", () => {
  const base = { divergence: null, moveCount: 4, replayHash: null, onChainHash: null, onChainEngineVersion: ENGINE_VERSION };
  it("is 'unavailable' while the engine has no hash", () => {
    expect(verify(base)).toMatchObject({ status: "unavailable", message: expect.stringMatching(/engine pending/) });
  });
  it("flags version skew first", () => {
    expect(verify({ ...base, onChainEngineVersion: "0.1.1" }).message).toMatch(/skew.*0\.1\.1/);
  });
  it("flags divergence", () => {
    expect(verify({ ...base, divergence: { moveIndex: 7, reason: "x" } }).message).toMatch(/move 7/);
  });
  it("compares hashes once both exist", () => {
    expect(verify({ ...base, replayHash: "0xAB", onChainHash: "0xab" }).status).toBe("match");
    expect(verify({ ...base, replayHash: "0xab", onChainHash: "0xcd" }).status).toBe("mismatch");
  });
});
