import { randomUUID } from "node:crypto";

import { getLaundryCartWorkspace } from "@/lib/laundry-cart/administration";

import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import { createLaundryCart } from "./actions";
import { CartListClient } from "./cart-list-client";

type LaundryCartsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LaundryCartsPage({
  searchParams,
}: LaundryCartsPageProps) {
  const workspace = await getLaundryCartWorkspace();
  const query = await searchParams;
  const cartResult = typeof query.cart === "string" ? query.cart : "";
  const savedCartNumber =
    typeof query.number === "string" ? query.number : "";

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>FIXED ASSET QR</p>
            <h1 id="workspace-title">洗衣車與固定 QR</h1>
            <p className={styles.lede}>洗衣車編號與送洗機構建立後固定；作業據點依機構配對決定。</p>
          </div>
        </header>

        {cartResult === "applied" ? (
          <p className={styles.successNotice} role="status">
            已登錄洗衣車 {savedCartNumber}。
          </p>
        ) : cartResult === "activated" || cartResult === "deactivated" ? (
          <p className={styles.successNotice} role="status">
            已{cartResult === "activated" ? "啟用" : "停用"}洗衣車{" "}
            {savedCartNumber}。
          </p>
        ) : cartResult === "invalid" ? (
          <p className={styles.errorNotice} role="alert">
            洗衣車資料無效，沒有套用任何變更。
          </p>
        ) : cartResult === "failed" ? (
          <p className={styles.errorNotice} role="alert">
            洗衣車異動失敗，未套用任何變更。
          </p>
        ) : null}

        <ModuleTabs
          ariaLabel="洗衣車管理功能"
          storageKey="laundry-carts"
          defaultTab="list"
          tabs={[
            { id: "create", label: "登錄洗衣車", description: "建立車號與固定 QR" },
            { id: "list", label: "洗衣車清單", description: "啟停、查閱與列印 QR", count: workspace.carts.length },
          ]}
        >
        <section className={styles.managementSection} aria-labelledby="create-cart-title">
          <div className={styles.sectionHeading}>
            <h2 id="create-cart-title">登錄洗衣車</h2>
            <p>洗衣車編號與送洗機構建立後固定；作業據點依機構配對決定。</p>
          </div>
          <form action={createLaundryCart} className={styles.accessForm}>
            <input name="change_request_id" type="hidden" value={randomUUID()} />
            <label>
              洗衣車編號
              <input name="cart_number" maxLength={40} required />
            </label>
            <label>
              送洗機構
              <select
                name="institution_code"
                defaultValue={workspace.institutions[0]?.code}
                required
              >
                {workspace.institutions.map((institution) => (
                  <option key={institution.id} value={institution.code}>
                    {institution.code} · {institution.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              登錄理由
              <input name="change_reason" maxLength={500} required />
            </label>
            <button type="submit">登錄洗衣車</button>
          </form>
        </section>

        <section aria-labelledby="cart-list-title">
          <h2 id="cart-list-title">目前洗衣車</h2>
          <CartListClient
            carts={workspace.carts}
            institutions={workspace.institutions}
          />
        </section>
        </ModuleTabs>
      </section>
    </main>
  );
}
