/**
 * Which member visits which target lecture, and when.
 *
 * Goal, in this order:
 *  1. visit as many target lectures as possible (each at most once),
 *  2. among those plans, visit the lectures with the largest audience,
 *  3. then spread the visits: as many members as possible get a visit before anyone gets a second.
 * Constraints: a member visits at most `maxPerPerson` lectures in total and at most
 * `maxPerDay` per day, and only sessions their (confirmed) availability covers.
 *
 * This is solved exactly as a min-cost max-flow:
 *   source -> lecture (1) -> (member, day) (maxPerDay) -> member (maxPerPerson) -> sink
 * An edge lecture -> (member, day) exists if the member is free at a session of that lecture on
 * that day. Every max flow visits the most lectures; the costs pick the best of those plans:
 * -audience * AUDIENCE_WEIGHT on the lecture edge, and a member's 2nd, 3rd ... visit costs
 * 1, 2 ... more than the first. Successive shortest paths (Bellman-Ford, the graph is tiny)
 * yields the cheapest maximum flow.
 */

export type AssignLecture = { id: string; title: string; audience: number }

/** One way to visit a lecture: a member who is free at one of its sessions. */
export type AssignOption = {
  lectureId: string
  memberId: string
  day: string // YYYY-MM-DD
  start: Date
  label: string
  location: string | null
}

export type AssignParams = { maxPerPerson: number; maxPerDay: number }

export type AssignResult = {
  visits: AssignOption[]
  /** Target lectures without a visit, and why */
  unvisited: { lecture: AssignLecture; reason: string }[]
  /** Visits per member */
  load: Map<string, number>
}

// Audience dominates the spreading term (at most maxPerPerson^2 * members, far below 1 student)
const AUDIENCE_WEIGHT = 10_000

type Edge = { to: number; cap: number; cost: number; rev: number; option?: AssignOption }

class Graph {
  adj: Edge[][] = []
  node() { this.adj.push([]); return this.adj.length - 1 }
  edge(from: number, to: number, cap: number, cost: number, option?: AssignOption) {
    this.adj[from].push({ to, cap, cost, rev: this.adj[to].length, option })
    this.adj[to].push({ to: from, cap: 0, cost: -cost, rev: this.adj[from].length - 1 })
  }
  /** Successive shortest augmenting paths; returns the flow. */
  minCostMaxFlow(s: number, t: number): number {
    let flow = 0
    for (;;) {
      const n = this.adj.length
      const dist = new Array<number>(n).fill(Infinity)
      const prev = new Array<[number, number] | null>(n).fill(null)
      dist[s] = 0
      for (let round = 0, changed = true; changed && round < n; round++) {
        changed = false
        for (let u = 0; u < n; u++) {
          if (dist[u] === Infinity) continue
          this.adj[u].forEach((e, i) => {
            if (e.cap > 0 && dist[u] + e.cost < dist[e.to]) { dist[e.to] = dist[u] + e.cost; prev[e.to] = [u, i]; changed = true }
          })
        }
      }
      if (dist[t] === Infinity) return flow
      let push = Infinity
      for (let v = t; v !== s; v = prev[v]![0]) push = Math.min(push, this.adj[prev[v]![0]][prev[v]![1]].cap)
      for (let v = t; v !== s; v = prev[v]![0]) {
        const e = this.adj[prev[v]![0]][prev[v]![1]]
        e.cap -= push
        this.adj[v][e.rev].cap += push
      }
      flow += push
    }
  }
}

export function assignVisits(lectures: AssignLecture[], options: AssignOption[], params: AssignParams): AssignResult {
  const g = new Graph()
  const source = g.node()
  const sink = g.node()
  const lectureNode = new Map<string, number>()
  for (const l of lectures) {
    const v = g.node()
    lectureNode.set(l.id, v)
    g.edge(source, v, 1, -Math.round(l.audience) * AUDIENCE_WEIGHT)
  }
  const memberNode = new Map<string, number>()
  const dayNode = new Map<string, number>()
  for (const o of options) {
    const lv = lectureNode.get(o.lectureId)
    if (lv === undefined) continue
    let mv = memberNode.get(o.memberId)
    if (mv === undefined) {
      mv = g.node()
      memberNode.set(o.memberId, mv)
      // One unit edge per visit, each dearer than the one before: spreads the visits
      for (let k = 0; k < params.maxPerPerson; k++) g.edge(mv, sink, 1, k)
    }
    const key = `${o.memberId}|${o.day}`
    let dv = dayNode.get(key)
    if (dv === undefined) {
      dv = g.node()
      dayNode.set(key, dv)
      g.edge(dv, mv, params.maxPerDay, 0)
    }
    g.edge(lv, dv, 1, 0, o)
  }
  g.minCostMaxFlow(source, sink)

  const visits: AssignOption[] = []
  for (const [, lv] of lectureNode) {
    for (const e of g.adj[lv]) if (e.option && e.cap === 0) visits.push(e.option)
  }
  visits.sort((a, b) => a.start.getTime() - b.start.getTime())
  const visited = new Set(visits.map(v => v.lectureId))
  const withOptions = new Set(options.map(o => o.lectureId))
  const load = new Map<string, number>()
  for (const v of visits) load.set(v.memberId, (load.get(v.memberId) ?? 0) + 1)
  return {
    visits,
    unvisited: lectures.filter(l => !visited.has(l.id)).map(lecture => ({
      lecture,
      reason: withOptions.has(lecture.id)
        ? 'Everyone free at its sessions is already used up (2 visits or 1 that day)'
        : 'Nobody is free at any of its sessions in the period',
    })),
    load,
  }
}
