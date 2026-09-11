import { requireAnyRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope, withWorkspaceScope } from "@/lib/auth/workspace-scope";
import { getLaundryOrderHistory } from "@/lib/analytics/order-history";

import { AppLink } from "../app-link";
import { HistoryResults } from "../history-results";
import styles from "../workspace.module.css";

type HistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const pageSize = 20;

function singleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function toDateInput(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function parseDateInput(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return null;
  const [year, month, day] = value.split("-").map(Number);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? date : null;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { from: formatDateInput(start), to: formatDateInput(end) };
}

function parseDateRange(fromValue: string | undefined, toValue: string | undefined) {
  const defaults = defaultDateRange();
  const from = toDateInput(fromValue) ?? defaults.from;
  const to = toDateInput(toValue) ?? defaults.to;
  const start = parseDateInput(from);
  const end = parseDateInput(to);
  const valid = Boolean(start && end && end >= start);
  const fallbackStart = parseDateInput(defaults.from)!;
  const fallbackEnd = parseDateInput(defaults.to)!;
  const endExclusive = new Date(end ?? fallbackEnd);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const resolvedStart = valid && start ? start : fallbackStart;
  const resolvedEnd = valid ? endExclusive : new Date(fallbackEnd.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: valid ? from : defaults.from,
    to: valid ? to : defaults.to,
    periodStart: resolvedStart.toISOString(),
    periodEnd: resolvedEnd.toISOString(),
  };
}

function historyHref(
  scope: { siteId: string | null; institutionId: string | null },
  filters: { from: string; to: string; query: string; page?: number },
) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.query) params.set("q", filters.query);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return withWorkspaceScope(`/app/history?${params.toString()}`, scope);
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const query = await searchParams;
  await requireAnyRole(["laundry_worker", "laundry_supervisor", "institution_supervisor"]);
  const scope = await resolveWorkspaceScope(query);
  const dateRange = parseDateRange(singleValue(query.from), singleValue(query.to));
  const searchQuery = singleValue(query.q)?.trim().slice(0, 120) ?? "";
  const requestedPage = singleValue(query.page);
  const page = requestedPage && /^\d+$/.test(requestedPage) ? Math.max(Number(requestedPage), 1) : 1;
  const history = await getLaundryOrderHistory({
    siteId: scope.siteId ?? undefined,
    institutionId: scope.institutionId ?? undefined,
    periodStart: dateRange.periodStart,
    periodEnd: dateRange.periodEnd,
    query: searchQuery,
    page,
    pageSize,
  });

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="history-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>COMPLETED ORDERS</p>
            <h1 id="history-title">已取件洗衣單</h1>
            <p className={styles.lede}>查詢已實際取件結案的歷史洗衣單；這裡只讀取資料，不會改變任何作業狀態。</p>
          </div>
          <AppLink className={styles.headerLink} href={withWorkspaceScope("/app/dashboard", scope)}>
            回到進行中佇列 <span aria-hidden="true">→</span>
          </AppLink>
        </header>

        <form className={styles.historyFilters} method="get" action="/app/history" aria-label="已取件洗衣單查詢條件">
          {scope.siteId ? <input type="hidden" name="site" value={scope.siteId} /> : null}
          {scope.institutionId ? <input type="hidden" name="institution" value={scope.institutionId} /> : null}
          <label>
            開始日期
            <input type="date" name="from" defaultValue={dateRange.from} />
          </label>
          <label>
            結束日期
            <input type="date" name="to" defaultValue={dateRange.to} />
          </label>
          <label className={styles.historyQueryField}>
            搜尋單號、機構或洗衣車
            <input name="q" defaultValue={searchQuery} maxLength={120} placeholder="例如 MAIN-20260827-0001" />
          </label>
          <button type="submit">查詢歷史洗衣單</button>
        </form>

        {!history ? (
          <p className={styles.errorNotice} role="alert">目前無法載入授權範圍內的已取件洗衣單。</p>
        ) : (
          <section className={styles.historyResults} aria-labelledby="history-results-title">
            <div className={styles.sectionHeadingRow}>
              <div>
                <p className={styles.eyebrow}>HISTORY RESULTS</p>
                <h2 id="history-results-title">查詢結果</h2>
              </div>
              <p>{dateRange.from} 至 {dateRange.to} · 共 {history.total} 筆</p>
            </div>

            {history.items.length === 0 ? (
              <HistoryResults items={history.items} />
            ) : (
              <HistoryResults items={history.items} />
            )}

            {history.total > history.pageSize ? (
              <nav className={styles.queuePager} aria-label="已取件洗衣單分頁">
                {history.page > 1 ? (
                  <AppLink href={historyHref(scope, { from: dateRange.from, to: dateRange.to, query: searchQuery, page: history.page - 1 })}>← 上一頁</AppLink>
                ) : <span />}
                <span>第 {history.page} 頁／共 {Math.ceil(history.total / history.pageSize)} 頁</span>
                {history.page * history.pageSize < history.total ? (
                  <AppLink href={historyHref(scope, { from: dateRange.from, to: dateRange.to, query: searchQuery, page: history.page + 1 })}>下一頁 →</AppLink>
                ) : <span />}
              </nav>
            ) : null}
          </section>
        )}
      </section>
    </main>
  );
}
