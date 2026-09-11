"use client";
import {useEffect,useState} from "react";
import styles from "../cart/scan.module.css";

const TOKEN_KEY="wr_pending_cart_token";

function readPickupToken(){
  const hash=window.location.hash.slice(1);
  const match=/^v1\.cart\.(wrq_v1\.[^.]+\.[^.]+)$/.exec(hash);
  if(match)return match[1];
  try{return window.sessionStorage.getItem(TOKEN_KEY)}catch{return null}
}

function clearPendingToken(){
  try{window.sessionStorage.removeItem(TOKEN_KEY)}catch{/* ignore */}
}

export function PickupControl(){const[result,setResult]=useState<{kind:string;orderNumber?:string;status?:string;reasonCode?:string}|null>(null);useEffect(()=>{const qrToken=readPickupToken();window.history.replaceState(null,"",`${window.location.pathname}${window.location.search}`);clearPendingToken();if(!qrToken){window.setTimeout(()=>setResult({kind:"denied",reasonCode:"invalid_qr"}),0);return}void fetch("/api/scan/pickup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({qr_token:qrToken,change_request_id:crypto.randomUUID()})}).then(async response=>setResult(await response.json())).catch(()=>setResult({kind:"failed",reasonCode:"service_unavailable"}))},[]);return <div aria-live="polite">{result?.kind==="picked-up"||result?.kind==="already-picked-up"?<div className={styles.success} role="status"><h2>取件完成</h2><p>洗衣單編號：<strong>{result.orderNumber}</strong></p><p>目前狀態：已取件。</p></div>:result?<div className={styles.error} role="alert"><h2>目前無法取件</h2><p>{result.reasonCode==="not_pickup_ready"?"這台車目前沒有可取件洗衣單。":"固定車卡 QR 無效或目前不可取件。"}</p></div>:<p>正在確認固定車卡並結案…</p>}</div>}
