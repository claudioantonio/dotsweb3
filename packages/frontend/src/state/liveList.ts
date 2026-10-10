import type { MatchSummary, Notice } from "@dotsweb3/protocol";

/**
 * Lobby/queue "live matches" list: seeded from inspect `session().liveMatches`
 * and kept current by the notice stream. Idempotent per notice. Scores are the
 * sums of machine-reported `squaresClosed` (display aggregation only).
 */
export function applyToLiveList(list: readonly MatchSummary[], n: Notice): MatchSummary[] {
  switch (n.type) {
    case "MatchStarted": {
      if (list.some((m) => m.matchId === n.matchId)) return [...list];
      const [a, b] = [n.players[0].toLowerCase(), n.players[1].toLowerCase()];
      const added: MatchSummary = {
        matchId: n.matchId,
        players: [a, b],
        scores: { [a]: 0, [b]: 0 },
        moveCount: 0,
        turn: n.firstMover.toLowerCase(),
        forfeitDeadline: n.forfeitDeadline,
        startedAt: n.timestamp,
      };
      return [...list, added].sort((x, y) => Number(x.matchId) - Number(y.matchId));
    }
    case "Move":
      return list.map((m) => {
        if (m.matchId !== n.matchId || n.moveIndex < m.moveCount) return m;
        const who = n.submitter.toLowerCase();
        return {
          ...m,
          moveCount: n.moveIndex + 1,
          scores: { ...m.scores, [who]: (m.scores[who] ?? 0) + n.squaresClosed },
          turn: n.turnAfter.toLowerCase(),
          forfeitDeadline: n.forfeitDeadline ?? m.forfeitDeadline,
        };
      });
    case "MatchEnded":
      return list.filter((m) => m.matchId !== n.matchId);
  }
}

export function liveListFrom(seed: readonly MatchSummary[], notices: readonly Notice[]): MatchSummary[] {
  let out = [...seed];
  for (const n of notices) out = applyToLiveList(out, n);
  return out;
}
