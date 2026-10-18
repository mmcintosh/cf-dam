/**
 * D1 allows 1,000 queries per Worker invocation on Workers Paid (50 on Free); past that, every query
 * fails. Long-running work (the sweep) counts its round trips with this and stops a stage before the
 * invocation runs out, leaving the rest for the next run.
 */
export const QUERIES_PER_INVOCATION = 1000

export interface QueryBudget {
  db: D1Database
  /** Round trips made through `db` so far (a batch is one). */
  used(): number
}

export function countQueries(db: D1Database): QueryBudget {
  let used = 0
  // batch() needs D1's own statements, so each wrapped one remembers what it wraps.
  const real = new WeakMap<object, D1PreparedStatement>()
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') return (...values: unknown[]) => wrap(target.bind(...values))
        const value = Reflect.get(target, prop, target)
        if (prop === 'run' || prop === 'all' || prop === 'first' || prop === 'raw') {
          return (...args: unknown[]) => {
            used++
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    real.set(wrapped, statement)
    return wrapped
  }
  const counted = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql))
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          used++
          return target.batch(statements.map((s) => real.get(s) ?? s))
        }
      }
      if (prop === 'exec') {
        return (sql: string) => {
          used++
          return target.exec(sql)
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { db: counted, used: () => used }
}
