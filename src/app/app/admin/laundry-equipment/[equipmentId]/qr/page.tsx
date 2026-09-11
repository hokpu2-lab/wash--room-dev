import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";

import { getLaundryEquipmentCard } from "@/lib/laundry-equipment/administration";
import styles from "../../../../workspace.module.css";
import { reissueLaundryEquipmentQrAction } from "../../actions";

import { PrintButton } from "./print-button";

export default async function LaundryEquipmentQrPage({ params, searchParams }: { params: Promise<{ equipmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { equipmentId } = await params; const equipment = await getLaundryEquipmentCard(equipmentId); if (!equipment) notFound(); const query = await searchParams; const assetPath = `/app/admin/laundry-equipment/${equipment.id}/qr-asset/svg`;
  return <main className={styles.shell}><section className={`${styles.panel} ${styles.qrPrintSheet}`} aria-labelledby="qr-title"><p className={styles.eyebrow}>FIXED ASSET QR</p><h1 id="qr-title">{equipment.name} 固定 QR</h1><p className={styles.screenOnly}><a href="/app/admin/laundry-equipment">返回洗衣設備清單</a></p>{query.qr === "reissued" ? <p className={`${styles.successNotice} ${styles.screenOnly}`} role="status">舊 QR 已撤銷，已重發版本 {query.version}。</p> : null}<dl className={styles.assetFacts}><div><dt>作業據點</dt><dd>{equipment.operating_sites.code} · {equipment.operating_sites.name}</dd></div><div><dt>設備類型</dt><dd>{equipment.equipment_type}</dd></div><div><dt>狀態</dt><dd>{equipment.status}</dd></div><div><dt>QR 版本</dt><dd>{equipment.current_qr_version}</dd></div></dl>    <div className={styles.qrCard}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`${equipment.name} 固定 QR`} height={720} src={assetPath} width={640} />
    </div><div className={`${styles.qrActions} ${styles.screenOnly}`}><a href={`${assetPath}?download=1`} download>下載 SVG</a><PrintButton /></div><section className={`${styles.managementSection} ${styles.dangerZone} ${styles.screenOnly}`} aria-labelledby="reissue-title"><h2 id="reissue-title">例外撤銷與重發</h2><p>只有外洩、損壞或遺失時重發；舊 QR 立即永久失效。</p><form action={reissueLaundryEquipmentQrAction} className={styles.accessForm}><input name="laundry_equipment_id" type="hidden" value={equipment.id} /><input name="change_request_id" type="hidden" value={randomUUID()} /><label>例外重發理由<input name="change_reason" maxLength={500} required /></label><label className={styles.checkboxLabel}><input name="reissue_confirmed" type="checkbox" required />我確認這是例外重發</label><button type="submit">撤銷舊 QR 並重發</button></form></section></section></main>;
}
