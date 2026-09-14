import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";

import { getLaundryCartQrCard } from "@/lib/laundry-cart/administration";
import { getApplicationOrigin } from "@/lib/supabase/config";

import styles from "../../../../workspace.module.css";
import { reissueLaundryCartQrAction } from "../../actions";
import { PrintButton } from "./print-button";

type LaundryCartQrPageProps = {
  params: Promise<{ cartId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LaundryCartQrPage({
  params,
  searchParams,
}: LaundryCartQrPageProps) {
  const { cartId } = await params;
  const cart = await getLaundryCartQrCard(cartId);

  if (!cart) notFound();

  const query = await searchParams;
  const qrResult = typeof query.qr === "string" ? query.qr : "";
  const qrVersion =
    typeof query.version === "string" && /^\d+$/.test(query.version)
      ? query.version
      : "";
  const assetPath = `/app/admin/laundry-carts/${cart.id}/qr-asset/svg`;

  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  let origin = host ? `${proto}://${host}` : "";
  if (!origin) {
    try {
      origin = getApplicationOrigin();
    } catch {
      origin = "https://wash-room.vercel.app";
    }
  }

  const tokenHash = cart.qrToken ? `#v1.cart.${cart.qrToken}` : "";
  const scanUrl = `${origin}/scan/cart/c/${cart.id}${tokenHash}`;

  return (
    <main className={styles.shell}>
      <section
        className={`${styles.panel} ${styles.qrPrintSheet}`}
        aria-labelledby="qr-title"
      >
        <p className={styles.eyebrow}>FIXED ASSET QR</p>
        <h1 id="qr-title">{cart.cartNumber} 固定 QR</h1>
        <p className={styles.screenOnly}>
          <a href="/app/admin/laundry-carts">返回洗衣車清單</a>
        </p>

        {qrResult === "reissued" ? (
          <p
            className={`${styles.successNotice} ${styles.screenOnly}`}
            role="status"
          >
            舊 QR 已撤銷，已重發版本 {qrVersion}。
          </p>
        ) : qrResult === "failed" ? (
          <p
            className={`${styles.errorNotice} ${styles.screenOnly}`}
            role="alert"
          >
            QR 重發失敗，舊 QR 狀態未變更。
          </p>
        ) : null}

        <dl className={styles.assetFacts}>
          <div>
            <dt>送洗機構</dt>
            <dd>
              {cart.institutionCode} · {cart.institutionName}
            </dd>
          </div>
          <div>
            <dt>作業據點</dt>
            <dd>
              {cart.siteCode} · {cart.siteName}
            </dd>
          </div>
          <div>
            <dt>狀態</dt>
            <dd>{cart.active ? "啟用" : "停用"}</dd>
          </div>
          <div>
            <dt>QR 版本</dt>
            <dd>{cart.qrVersion}</dd>
          </div>
        </dl>

        <div className={styles.qrCard}>
          <Image
            alt={`${cart.cartNumber} 固定 QR`}
            height={720}
            src={assetPath}
            unoptimized
            width={640}
          />
          <p className={styles.qrTargetUrl}>
            掃碼帶入網址：
            <a href={scanUrl} target="_blank" rel="noreferrer">
              {scanUrl}
            </a>
          </p>
        </div>
        <div className={`${styles.qrActions} ${styles.screenOnly}`}>
          <a href={`${assetPath}?download=1`} download>
            下載 SVG
          </a>
          <PrintButton />
        </div>

        <section
          className={`${styles.managementSection} ${styles.dangerZone} ${styles.screenOnly}`}
          aria-labelledby="reissue-title"
        >
          <div className={styles.sectionHeading}>
            <h2 id="reissue-title">例外撤銷與重發</h2>
            <p>
              只限 QR 外洩、車卡損壞或遺失時使用；舊 QR 會立即永久失效。
            </p>
          </div>
          <form action={reissueLaundryCartQrAction} className={styles.accessForm}>
            <input name="laundry_cart_id" type="hidden" value={cart.id} />
            <input name="change_request_id" type="hidden" value={randomUUID()} />
            <label>
              例外重發理由
              <input name="change_reason" maxLength={500} required />
            </label>
            <label className={styles.checkboxLabel}>
              <input name="reissue_confirmed" type="checkbox" required />
              我確認這是外洩、損壞或遺失的例外重發
            </label>
            <button type="submit">撤銷舊 QR 並重發</button>
          </form>
        </section>
      </section>
    </main>
  );
}
