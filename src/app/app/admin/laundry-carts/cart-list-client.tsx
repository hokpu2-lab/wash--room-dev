"use client";

import { useState } from "react";

import styles from "../../workspace.module.css";
import { changeLaundryCartActive } from "./actions";
import { formatInstitutionLabel } from "./institution-label";

export { formatInstitutionLabel };

type CartItem = {
  id: string;
  cart_number: string;
  active: boolean;
  has_ready_pickup: boolean;
  institutions: {
    code: string;
    name: string;
    operating_sites: {
      code: string;
      name: string;
    };
  };
};

type InstitutionItem = {
  id: string;
  code: string;
  name: string;
  operating_sites: {
    code: string;
    name: string;
  };
};


export type CartListClientProps = {
  carts: CartItem[];
  institutions: InstitutionItem[];
};

export function CartListClient({ carts, institutions }: CartListClientProps) {
  const [selectedInstitutionCode, setSelectedInstitutionCode] = useState<string | null>(null);

  const institutionList =
    institutions.length > 0
      ? institutions
      : Array.from(new Set(carts.map((c) => c.institutions.code))).map((code) => {
          const cart = carts.find((c) => c.institutions.code === code);
          return {
            id: code,
            code,
            name: cart?.institutions.name ?? code,
            operating_sites: cart?.institutions.operating_sites ?? { code: "", name: "" },
          };
        });

  const filteredCarts = selectedInstitutionCode
    ? carts.filter((cart) => cart.institutions.code === selectedInstitutionCode)
    : carts;

  const currentInstitution = institutionList.find((i) => i.code === selectedInstitutionCode);

  return (
    <div>
      <div
        className={styles.queueFilterGroup}
        role="tablist"
        aria-label="依照送洗機構分類標籤"
        style={{ marginBottom: "1.25rem", gap: "10px" }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedInstitutionCode === null}
          className={
            selectedInstitutionCode === null
              ? `${styles.filterPill} ${styles.filterPillLarge} ${styles.filterPillAll} ${styles.filterPillActive}`
              : `${styles.filterPill} ${styles.filterPillLarge} ${styles.filterPillAll}`
          }
          onClick={() => setSelectedInstitutionCode(null)}
        >
          全部 ({carts.length})
        </button>
        {institutionList.map((inst) => {
          const count = carts.filter((c) => c.institutions.code === inst.code).length;
          const isSelected = selectedInstitutionCode === inst.code;
          const labelName = formatInstitutionLabel(inst.code, inst.name);
          return (
            <button
              key={inst.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={
                isSelected
                  ? `${styles.filterPill} ${styles.filterPillLarge} ${styles.filterPillBlue} ${styles.filterPillActive}`
                  : `${styles.filterPill} ${styles.filterPillLarge} ${styles.filterPillBlue}`
              }
              onClick={() => setSelectedInstitutionCode(inst.code)}
            >
              {labelName} ({count})
            </button>
          );
        })}
      </div>

      {filteredCarts.length === 0 ? (
        <div className={styles.emptyQueueBox}>
          <p className={styles.emptyQueue}>
            {currentInstitution
              ? `目前「${formatInstitutionLabel(currentInstitution.code, currentInstitution.name)}」尚無洗衣車。`
              : "目前管理範圍內尚無洗衣車。"}
          </p>
        </div>
      ) : (
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th scope="col">洗衣車編號</th>
                <th scope="col">送洗機構</th>
                <th scope="col">作業據點</th>
                <th scope="col">狀態</th>
                <th scope="col">待取件車號</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCarts.map((cart) => (
                <tr key={cart.id}>
                  <td>{cart.cart_number}</td>
                  <td>
                    {cart.institutions.code} · {cart.institutions.name}
                  </td>
                  <td>{cart.institutions.operating_sites.name}</td>
                  <td>{cart.active ? "啟用" : "停用"}</td>
                  <td>{cart.has_ready_pickup ? cart.cart_number : "—"}</td>
                  <td>
                    <form
                      action={changeLaundryCartActive}
                      className={styles.compactForm}
                    >
                      <input
                        name="laundry_cart_id"
                        type="hidden"
                        value={cart.id}
                      />
                      <input
                        name="cart_number"
                        type="hidden"
                        value={cart.cart_number}
                      />
                      <input
                        name="target_active"
                        type="hidden"
                        value={cart.active ? "false" : "true"}
                      />
                      <input
                        name="change_request_id"
                        type="hidden"
                        value={crypto.randomUUID()}
                      />
                      <input
                        aria-label={`${cart.cart_number} 啟停理由`}
                        name="change_reason"
                        maxLength={500}
                        required
                      />
                      <button type="submit">
                        {cart.active ? "停用" : "啟用"} {cart.cart_number}
                      </button>
                    </form>
                    <a href={`/app/admin/laundry-carts/${cart.id}/qr`}>
                      查看 {cart.cart_number} 固定 QR
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
