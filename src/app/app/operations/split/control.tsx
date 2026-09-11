"use client";
import {useState} from "react";
import { usePreferredId } from "../../use-live-batches";
import { useLiveOrders } from "../../use-live-orders";
import styles from "../../workspace.module.css";
export function SplitControl({orders:initial,categories}:{orders:{id:string;status:string}[];categories:{code:string;name:string}[]}){
  const {orders}=useLiveOrders(initial,["awaiting_cleaning","in_process"]);
  const[orderId,setOrderId]=usePreferredId(orders.map(order=>order.id));
  const[selected,setSelected]=useState<string[]>([]);
  const[result,setResult]=useState<{kind:string;batchCount?:number;reasonCode?:string}|null>(null);
  async function submit(){
    const response=await fetch("/api/operations/split-batches",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({order_id:orderId,category_codes:selected,change_request_id:crypto.randomUUID()})});
    setResult(await response.json());
  }
  return <div aria-live="polite"><label>洗衣單<select value={orderId} onChange={event=>setOrderId(event.target.value)}>{orders.length===0?<option value="">目前沒有可拆分洗衣單</option>:orders.map(order=><option key={order.id} value={order.id}>{(order as {orderNumber?:string}).orderNumber??`洗衣單 ${order.id.slice(0,8)}`}</option>)}</select></label><fieldset><legend>新增必要分類</legend>{categories.map(category=><label key={category.code} className={styles.checkboxLabel}><input type="checkbox" checked={selected.includes(category.code)} onChange={event=>setSelected(current=>event.target.checked?[...current,category.code]:current.filter(code=>code!==category.code))}/>{category.name}（{category.code}）</label>)}</fieldset><button type="button" onClick={submit} disabled={!orderId||selected.length===0}>建立必要批次</button>{result?.reasonCode?<p className={styles.errorNotice} role="alert">拆分未完成：{result.reasonCode}</p>:result?<p className={styles.successNotice} role="status">已建立 {result.batchCount??0} 個必要批次。</p>:null}</div>;
}
