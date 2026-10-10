import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, Replayer, boardHash, rebuild } from "./engine-adapter";
import { A, B, records } from "./state/__fixtures__";

describe("engine adapter", () => {
  it("ENGINE_VERSION equals the installed dots-engine version", () => {
    const require = createRequire(import.meta.url);
    // package.json is not in the engine's "exports"; resolve the entry and walk up.
    const pkgPath = join(dirname(require.resolve("dots-engine")), "..", "package.json");
    expect(JSON.parse(readFileSync(pkgPath, "utf8")).version).toBe(ENGINE_VERSION);
  });

  it("rebuilds a full match from the move log via the engine", () => {
    const { board, divergence } = rebuild(2, [A, B], "1", records);
    expect(divergence).toBeNull();
    expect(board.edges).toHaveLength(4);
    expect(board.squares).toEqual([{ row: 0, col: 0, owner: B }]);
    expect(board.scores[B]).toBe(1);
    expect(board.over).toBe(true);
  });

  it("detects divergence when a record disagrees with the engine", () => {
    const tampered = records.map((r) => (r.moveIndex === 3 ? { ...r, squaresClosed: 0 } : r));
    expect(rebuild(2, [A, B], "1", tampered).divergence).toMatchObject({ moveIndex: 3 });
  });

  it("detects a wrong turnAfter and an illegal move", () => {
    const wrongTurn = records.map((r) => (r.moveIndex === 0 ? { ...r, turnAfter: A } : r));
    expect(rebuild(2, [A, B], "1", wrongTurn).divergence?.moveIndex).toBe(0);
    const outOfTurn = [{ ...records[0], submitter: B }];
    expect(rebuild(2, [A, B], "1", outOfTurn).divergence?.reason).toMatch(/turn/i);
  });

  it("flags a gap in move indices and stays diverged", () => {
    const r = new Replayer(2, [A, B], "1");
    expect(r.apply(records[0])).toBeNull();
    expect(r.apply(records[2])).toMatchObject({ moveIndex: 1 });
    expect(r.apply(records[1])).toMatchObject({ moveIndex: 1 });
  });

  it("boardHash is a stub until the engine ships one", () => {
    expect(boardHash(rebuild(2, [A, B], "1", records).board)).toBeNull();
  });
});
