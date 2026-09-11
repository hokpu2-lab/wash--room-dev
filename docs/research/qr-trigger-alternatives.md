# 固定 QR 觸發點替代或優化研究

> 研究日期：2026-08-27
>
> 本文件是獨立研究，只修改本檔案，不代表已決定導入，也沒有修改產品程式、資料庫或 migration。外部資料以平台原廠、標準組織及設備／標籤供應商的第一方技術文件為主；供應商的耐用度與讀距數字仍應在本系統的實際洗衣環境做 proof of concept（PoC）驗證。

## 1. 執行摘要

目前系統的固定 QR 不只是「資產編號」：它是固定資產的不可猜測 bearer credential。匿名送單／取件必須帶著 QR credential，由受限入口在伺服器端重新驗證資產、送洗機構、作業據點、狀態、限流與冪等；已登入洗衣員則以同一固定 QR 作為洗衣車或設備控制點的辨識入口。這個模型的優點是匿名人員不需安裝 App，缺點是手機必須開相機、對準、等待解碼、再確認。

結論先行：

1. **短期最值得做的是保留 QR，升級「輸入方式」而非更換 credential。** 對仍使用手機的送洗人員，先改善 QR 卡的尺寸、對比、抗反光、固定位置與掃碼頁的連續操作；對洗衣房高頻作業，再試用帶實體觸發鍵的專用 2D 掃碼器或帶整合掃碼引擎的 Android PDA。這樣可以減少瞄準與按螢幕的操作，且 QR 的匿名安全模型仍可維持。
2. **NFC 最接近「手機一碰」的體驗，但不適合作為目前跨平台匿名 Web bearer 的直接替代。** NFC 的距離短、誤觸發較少；然而 Web NFC 的可用範圍主要是 Android Chrome 的 NDEF，iOS 背景讀取會顯示通知並要求使用者點擊，鎖定時還要解鎖。NDEF 或 tag UID 本身也不是秘密，不能直接取代 QR bearer。
3. **RFID 適合「大量衣物／車籠盤點」，不一定適合「單一控制點觸發」。** UHF 可隔著容器、非視線讀取多個 tag，但其讀取區域可能同時看到鄰近洗衣車、設備或衣物；金屬、水分、濕布、天線方向與功率都會影響結果。若要用在控制點，應採近場／受控讀取區、明確選擇單一預期 tag，並保留人工確認與 QR fallback。
4. **BLE beacon 不宜直接代表「已到達某台設備」；BLE 按鈕與固定 kiosk 比較適合作業站優化。** Beacon 的 proximity 是相對訊號範圍，不是精確位置或意圖；背景掃描、權限、電量與作業系統限制也會帶來不確定性。固定 Android kiosk 搭配實體按鈕、專用掃碼器或 NFC/RFID reader，反而能把「目前工作站」固定下來，讓人員只需選批次／按確認。

### 建議評估排序

| 優先級 | 方案 | 建議定位 | 對既有 bearer 模型的影響 |
| --- | --- | --- | --- |
| A | 手機相機 + 更好的 QR 卡／掃碼 UX | 保持匿名送單／取件的最低成本主路徑 | 幾乎不變；仍由 QR bearer 驗證 |
| A | Android PDA 整合 2D scan engine | 洗衣員高頻收單、設備階段、裝車 | 可維持；把掃描輸出送到受控 App，不要讓 raw token 落入任意輸入框 |
| B | Bluetooth／USB 專用 2D scanner + 固定 Android／平板 | 固定工作站或控制中心 | 可維持；reader 只提供輸入，伺服器仍驗證 bearer |
| B | NFC tag + 原生 Android App／PDA | 內部人員「靠近即讀」的資產識別 | 不可把 UID/NDEF 當秘密；需改成已登入識別或另發短期交易 credential |
| B | HF／UHF RFID | 大量衣物、車籠、批次盤點；控制點須受控 | tag ID 是 identifier，不是 authorization；誤讀風險高於單一 QR |
| C | BLE beacon 自動觸發 | 提供附近提示、預選工作站，不直接寫入狀態 | 不可把 beacon ID／RSSI 當 bearer 或單獨授權 |
| A（固定站） | Android kiosk + 掃描器／按鈕 | 送洗櫃台、洗衣設備旁、裝車站 | 站點裝置持有登入 session；匿名流程仍應由 QR／一次性交易授權 |

## 2. 既有流程與評估邊界

### 2.1 現有系統的安全與領域不變量

本研究以 repo 的 authoritative 文件與實作為基準：

- [CONTEXT.md](../../CONTEXT.md) 將洗衣車定義為可重複使用、具有固定且唯一 QR 的實體載具，不是單次送洗紀錄。
- [docs/requirements.md](../requirements.md) 規定洗衣車、消毒鍋、洗衣機、烘衣機使用固定且唯一 QR；QR credential 在資產建檔時產生一次，正常操作不輪替；匿名送單／取件需驗證 credential、機構／據點配對、限流、冪等及狀態。
- [README.md](../../README.md) 描述 QR token 放在 URL fragment，進入頁面後清除，raw bearer 只透過受保護 POST body 傳送；資料庫只保存 digest／版本與歷史，不保存 raw token。
- 目前 [pending-qr-token.ts](../../src/app/scan/pending-qr-token.ts) 的實作會嘗試寫入 `sessionStorage` 與 `localStorage`。這是後續導入新輸入設備時必須重新檢視的現況風險；本研究不修改它，也不把任何新方案建立在瀏覽器持久化 raw bearer 上。

因此，「觸發」至少有兩層：

1. **辨識資產／控制點**：這是 QR、NFC、RFID、BLE 或掃碼器最直接能提供的功能。
2. **授權狀態變更**：這仍必須由既有登入 JWT、匿名 QR credential 或新的伺服器端短期交易 credential 完成。

任何方案若只證明「讀到一個 ID」，就直接建立洗衣單、完成取件或推進設備階段，會把現行「credential + scope + 狀態 + 冪等」安全邊界降級。

### 2.2 以作業情境拆開評估

| 情境 | 操作者 | 目前核心需求 | 更適合的輸入 |
| --- | --- | --- | --- |
| 送洗人員送單／取件 | 未登入、可能只用自己的手機 | 不安裝 App、識別固定洗衣車、只允許當下匿名動作 | QR 主路徑；NFC 可作輔助入口但不能只靠 UID 授權；固定 kiosk 可降低手機需求 |
| 洗衣員收單／分類 | 已登入、高頻重複 | 快速確認實體車與目前唯一允許流程 | Android PDA 整合掃碼引擎；QR fallback |
| 消毒／清洗／烘乾 | 已登入、設備旁 | 避免選錯機台、需要實體 proximity | PDA 2D scanner；固定 kiosk；若導入 RFID，使用受控近場 reader |
| 裝車 | 已登入、同時涉及車與批次來源 | 來源車逐一核對，避免把鄰車或多 tag 誤當同一車 | QR／專用掃碼器；RFID 僅在明確讀取區與人工確認下評估 |
| 大量衣物／車籠盤點 | 已登入或固定站 | 一次取得多個物品識別，追蹤遺失與流向 | UHF RFID；這是 RFID 相對 QR 的強項，但不是單筆狀態變更的直接替代 |

## 3. 方案一：繼續使用 QR，降低手機操作成本

### 3.1 手機相機：成本最低、現有流程相容性最高

Google ML Kit 的 Android Barcode Scanning API 支援 QR、Data Matrix、PDF417 等多種格式；若已知只需要 QR，可限定 decoder format 以改善速度。官方也建議依條碼大小提供足夠像素、避免失焦，並在即時串流中採取丟棄舊影像／等待連續相同結果等策略；auto-zoom 可在條碼過遠時輔助讀取。[Google ML Kit Android barcode scanning](https://developers.google.com/ml-kit/vision/barcode-scanning/android)

對目前手機 Web 流程，能先做的不是換技術，而是把「掃描成功率」和「掃描後步驟」做好：

- QR 卡使用高對比、足夠實體尺寸與寬留白；在車卡與設備卡上同時印可讀資產名稱、車號／設備號與使用說明，讓人員先核對實體。
- 將 QR 固定在不易彎折、刮傷、積水或被布料遮住的位置；避免透明覆膜產生鏡面反光。洗衣房可用可更換保護卡套，但不能讓保護膜讓 QR 失焦。
- 掃碼頁在成功讀取後自動進入正確控制點，減少「掃完開錯 App、再按瀏覽器、再找按鈕」；匿名頁仍保留明確的送單／取件確認，不能用自動讀取取代有意義的確認。
- 掃描視窗只接受預期 namespace／token pattern，連續影像中等同結果再提交，避免相機在同一畫面短時間回報多次造成重複請求。
- 對手機本身建立標準：近年機型、可戴手套操作、相機對焦速度、低光與逆光表現、耐摔／防水保護殼、消毒方式、電池與網路。這些應由代表性手機實測，不應從一般消費型規格推定洗衣房可用。

**優點**：不需新 reader、不需原生 App、不需配對；匿名送洗人員的學習成本最低，既有 QR bearer 也能保留。

**限制**：仍需對準與保持距離；濕手套、鏡面反光、髒污、低光、彎曲卡面與相機被其他 App 佔用都會影響成功率。若目前流程是「手機相機掃 URL」，不同 OS／瀏覽器可能有不同的 URL 預覽、權限與回到頁面行為，應把實體 QR 測試納入 E2E／現場驗收。

### 3.2 專用 2D 掃碼器：把「瞄準」變成「按扳機」

專用 2D imager 的價值不是 QR 更安全，而是鏡頭、照明、解碼器、觸發鍵與回饋被做成單一工具。以 Zebra 的官方文件為例，DataWedge 可從整合式 scanner、相機、Bluetooth／USB scanner 等來源接收 1D／2D barcode，並以 keystroke 或 Android intent 輸出；DataWedge 預裝於 Zebra Android 裝置，可用 profile 設定且不一定需要自行整合底層 scanner API。[Zebra DataWedge overview](https://techdocs.zebra.com/datawedge/latest/guide/about/)、[Barcode Input](https://techdocs.zebra.com/datawedge/latest/guide/input/barcode/)

對洗衣房有三種部署形態：

1. **Bluetooth／USB scanner + 現有手機／平板**：採購與維修分離；人員按 scanner trigger，裝置把掃到的 URL／token 輸入目前前景 App。適合固定櫃台，但任意手機瀏覽器的 focus、藍牙配對、鍵盤注入與背景切換都可能讓輸入落錯地方。
2. **固定桌面 scanner + kiosk**：最適合送洗／取件櫃台或裝車站。掃描器固定朝向，作業員只需把車卡／標籤放入讀取區；搭配全螢幕 kiosk，可把登入、目前工作站與按鈕固定下來。
3. **穿戴／手持 scanner**：適合洗衣員雙手常搬運衣物的情境；扳機可放在手指或裝置側邊，掃描回饋可用聲音、震動與 LED，降低每次看螢幕的需求。需選擇可清潔、耐摔、防水且能戴手套操作的型號。

安全整合上，優先使用受控 intent，而不是把 bearer token 當成任意文字輸入。Zebra 的 DataWedge Intent Output 支援指定 package，並可啟用 application signature check，避免同名但不同簽章的惡意 App 接收掃描資料；這是降低「scanner 把 raw token 送錯 App」風險的第一方做法。[Zebra Intent Output](https://techdocs.zebra.com/datawedge/latest/guide/output/intent/)

若不得不使用 keystroke wedge，至少應：

- 將裝置鎖定在作業 App／kiosk，禁止掃描結果進入一般文字欄位、瀏覽器網址列或聊天 App。
- 掃描資料進入 memory-only 的受控狀態後立即 POST；不要把 token 寫入 URL query／path、log、分析事件或持久化 storage。
- 將 scanner 的 suffix／prefix、重複掃描抑制與「處理中停用 trigger」設定成可測試的 profile。
- 對匿名流程仍保留伺服器端 QR credential 驗證；專用 scanner 只改善輸入，不是額外授權。

### 3.3 帶掃碼引擎的 Android PDA：高頻內部作業的最合理升級

Android PDA 把電話、實體掃碼鍵、耐用性、企業裝置管理與網路整合在同一設備。Zebra TC22／TC27 官方產品資料列出整合掃碼引擎、左右掃描鍵、NFC、Wi‑Fi 6／6E、可替換電池等企業功能；其宣稱的 standard／advanced range 最遠可達 12 m，實際仍要以 QR 尺寸、反光、角度與工作距離測試。[Zebra TC22／TC27 product overview](https://www.zebra.com/content/dam/zebra_dam/en/brochure/portfolio/tc22-tc27-brochure-product-overview-en-us.pdf)

**最適合的邊界**：洗衣員、洗衣主管、設備控制點與裝車站。內部人員已經有 JWT／角色／據點 scope，PDA 可包一個原生薄殼或受控 WebView，收到 scanner intent 後把「資產識別」送入既有 server-only action／route；資料層與 RPC 不必因為換 scanner 而重寫。

**不適合直接取代匿名手機流程的原因**：送洗機構人員不一定持有公司 PDA，也不應為一次送單安裝企業 App 或接受裝置管理。匿名送單／取件仍保留手機 QR 或提供固定櫃台 kiosk，兩者共存比強迫所有角色使用同一種設備更穩健。

### 3.4 QR 方案的建議 PoC

先不改 token 格式，挑選：

- 2 種現場常用手機（含 Android／iPhone）；
- 1 款 Bluetooth／USB 2D scanner；
- 1 款整合 scanner 的 Android PDA；
- 代表性的車卡、設備卡、保護膜、髒污／潮濕／低光與戴手套情境。

量測「從拿起設備到有效 server response」的 p50／p95、首次成功率、重複提交率、錯誤資產率、手套操作時間、電池／網路中斷復原與 token 是否出現在不應出現的 browser history／storage／log。沒有這組基準，不宜用主觀的「掃得比較快」決定採購。

## 4. 方案二：NFC／ISO 14443 與手機限制

### 4.1 技術定位

NFC Forum 將 NFC 定義為 13.56 MHz 的短距離無線技術，典型距離約至 2 cm，並支援 reader／writer、card emulation 與被動 tag；NFC Forum tag 通常以 NDEF 保存資料。NFC Forum 也列出與 ISO／IEC 14443 Type A／B、ISO／IEC 15693 等技術的互通關係。[NFC Forum NFC Technology](https://nfc-forum.org/learn/nfc-technology/)

ISO／IEC 14443 的不同部分各自描述 physical characteristics、初始化／防碰撞及傳輸協定；標準本身不保證每支手機、每個 tag 型號、每個瀏覽器都支援相同的應用層資料。可參考 [ISO／IEC 14443-1:2018](https://www.iso.org/standard/70170.html)、[ISO／IEC 14443-3:2018](https://www.iso.org/standard/70171.html) 與 [ISO／IEC 14443-4:2018](https://www.iso.org/standard/70172.html)。

對洗衣車／設備而言，NFC 的核心體驗是「把手機靠近正確位置」，不是遠距離掃描。因此它能降低攝影機對準成本，也天然降低鄰近資產同時被讀取的機會；代價是人員必須更精確地靠近 tag，且 tag／手機背面線圈位置、金屬車體與保護殼會影響體感。

### 4.2 Android 手機與 Web NFC

Android 官方 NFC overview 表示 Android 裝置通常同時支援 reader／writer 與 card emulation；Android framework 對 NDEF 支援最好，非 NDEF tag 往往需要自行處理 tag technology 與 raw bytes。[Android NFC overview](https://developer.android.com/develop/connectivity/nfc)

Android NFC basics 的 tag dispatch 通常在螢幕解鎖時尋找 tag，系統依 NDEF URI／MIME 或 tag technology 將事件交給符合 intent filter 的 Activity；官方建議在能控制 tag 內容時優先用 NDEF，以取得較廣泛的支援。[Android NFC basics](https://developer.android.com/develop/connectivity/nfc/nfc)

目前專案是 Next.js Web，不是 Android native App。若直接用 Web NFC，Chrome 官方文件指出：

- Web NFC 在 Chrome for Android 提供 NDEF tag 讀寫，並非完整低階 ISO-DEP／NFC-A／NFC-B／NFC-F／HCE API。
- `NDEFReader.scan()` 需要安全來源、NFC 硬體／設定與權限，且必須由 user gesture 觸發。
- 瀏覽器存在 `NDEFReader` 不代表裝置一定有 NFC 硬體；實際呼叫仍可能失敗。
- Web NFC 以 NDEF 為主，不應把它當成跨 iOS／Android 的通用 ISO 14443 reader。

來源：[Chrome for Android Web NFC](https://developer.chrome.com/docs/capabilities/nfc)。

### 4.3 iPhone／iPad 的讀取與寫入限制

Apple Core NFC 可在原生 App 讀取 NDEF tag，也可與 ISO 7816、ISO 15693、FeliCa、MIFARE 等 protocol-specific tag 互動；是否可用取決於裝置 NFC 能力與 App 的 reader session／entitlement。[Apple Core NFC](https://developer.apple.com/documentation/CoreNFC)

支援背景 tag reading 的 iPhone XS 及後續機型，可以在畫面亮起、手機使用中時讀到含 URI 的 NDEF tag，然後顯示 notification；使用者點擊後才將資料交給對應 App。鎖定時會要求解鎖；相機使用中、Apple Pay／Wallet 使用中、Airplane Mode、尚未解鎖或已有 Core NFC reader session 時，背景讀取不可用。Apple 也要求 App 同時提供 in-app reader，不能只假設背景讀取存在。[Apple background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading)、[Apple NFC HIG](https://developer.apple.com/design/human-interface-guidelines/nfc)

寫入不是安全功能本身：Apple 文件要求先確認 tag 狀態是 read-write，並可用 `writeLock` 將 tag 鎖成唯讀；Android 官方也說簡單 tag 可能具 read／write 語意，甚至有一次性可寫區，較複雜 tag 才可能具密碼學硬體。[Apple `writeNDEF`](https://developer.apple.com/documentation/corenfc/nfcndeftag/writendef%28_%3Acompletionhandler%3A%29)、[Android NFC overview](https://developer.android.com/develop/connectivity/nfc)

因此，用手機 NFC 觸發目前匿名 Web 流程，至少會遇到：Android／iOS 瀏覽器差異、NDEF URL 被 OS 先處理、iOS notification + tap、鎖定／相機／Wallet 互斥，以及 tag 被重寫或複製的問題。它比較適合已登入人員的原生／受控 App，不適合在沒有 App 的匿名取件流程中取代 QR。

### 4.4 NFC 導入建議

- **不要把 tag UID、NDEF URL 或可讀的固定字串當 bearer secret。** NDEF 內容可被讀出；可寫 tag 可能被改寫；UID／序號是識別資料，不等同持有不可複製的秘密。
- 內部流程可採「NFC 只解析 `asset_id` → 已登入 server 依 JWT scope resolve → 顯示目前唯一允許動作 → 使用者確認」。這是 identifier model，不破壞 QR bearer，但需要原生 App 或明確支援 Web NFC 的 Android 裝置。
- 若匿名流程一定要 NFC，NFC 只應啟動一個公開入口或帶短期 opaque locator；真正的匿名變更仍需 server-issued short-lived challenge／一次性 transaction credential、rate limit、冪等與狀態檢查。不要將永久 QR bearer 明文搬進 NDEF。
- tag 要選能承受清洗、消毒、壓力與金屬安裝的形式；先驗證手機在保護殼、手套、金屬車體、潮濕與錯誤鄰近 tag 下的讀取行為。

## 5. 方案三：RFID（被動 UHF／HF）

### 5.1 UHF 與 HF 的能力差異

GS1 的 EPC UHF Gen2 air interface 定義被動 UHF RFID 在約 860–930 MHz 的物理／邏輯需求；Gen2 系統以 inventory 操作在 interrogation zone 找到 tags，並具 anti-collision／singulation 概念。GS1 也指出 RAIN RFID 可不需 line of sight、以高速度讀取多個標籤，距離可能遠超過 10 m，但這種能力同時代表讀取範圍必須被工程化控制。[GS1 EPC UHF Gen2](https://www.gs1.org/standards/rfid/uhf-air-interface-protocol)、[GS1 System Architecture RFID](https://www.gs1.org/standards/gs1-system-architecture-document/current-standard)

HF／NFC 類 tag 在 13.56 MHz、短距離、近場耦合；洗衣業已有針對高溫、水、化學品與壓力設計的 HF textile tag。例如 HID BluTAG 官方規格列出 13.56 MHz、ISO 15693／ISO-18000-3、可承受商用洗滌循環；這是供應商產品宣稱，不代表所有 tag 或本系統現場都會達到同一結果。[HID BluTAG HF laundry tag](https://www.hidglobal.com/products/blutag-hf-laundry-tag)

UHF 也有專為洗衣紡織品與車籠設計的 tag。HID LinTRAK 產品頁列出 UHF EPC Class 1 Gen 2／ISO 18000-63、可承受反覆洗滌，並宣稱某些型號讀距可達 5 m；HID Laundry Cage Tag 則針對車籠／車車，列出 on-metal UHF 與可由手持終端或通道讀取。[HID LinTRAK](https://www.hidglobal.com/products/lintrak)、[HID Laundry Cage Tag](https://www.hidglobal.com/products/laundry-cage-tag)

### 5.2 洗衣車／設備標籤的可行性

**HF：較適合作為「靠近指定標籤」的 RFID 化 QR。** 讀距短、讀取區容易做成單一控制點，手機／PDA 只需靠近車卡或設備卡；若用 ISO 15693／NFC Type 5 類 tag，需確認 Android／iOS／Web API 的實際支援，而不能只看頻率名稱。HF 仍可能受金屬車體、tag 安裝方向、保護材料與 reader 線圈位置影響；應在每種車／設備材質上逐一測試。

**被動 UHF：較適合作為盤點與批次辨識，不宜無限制地拿來觸發單筆控制。** 它能在不瞄準、隔著布料或容器讀取多個 tag，適合盤點洗衣車、車籠、布品或出入站。但若設備旁同時有多台車、帶 RFID 的衣物／批次袋、金屬架與其他資產，reader 的 inventory 可能回傳多個 EPC。把「看到某 EPC」直接解讀成「操作者正在操作這台設備」會產生錯車、重複與跨站誤觸發。

### 5.3 誤讀／漏讀來源

這裡的風險有兩種，不能只測「平均讀距」：

1. **False positive（不該讀到卻讀到）**：遠處鄰近車、同一車上的衣物 tag、金屬架後方或另一個工作站的 tag 進入 UHF interrogation zone；高功率／大天線可能讓讀取區超出人員直覺。
2. **False negative（應讀到卻沒讀到）**：tag 被水／濕布／人體遮蔽、貼在金屬錯誤位置、方向不利、標籤受損、溫度／化學品造成失效、讀者與 tag 距離／角度不穩，或多 tag 競爭造成短時間未回報。

Impinj 的官方技術說明指出，液體會使 tag detune、限制 coverage；tag sensitivity、inlay 尺寸、材料與區域頻段都會影響 read range。其部署指南也明確要求大型 gateway deployment 先做 use-case 的 empirical proof of concept，並以 tagged item、coverage 與 inventory／location／direction mode 驗證，而不是只依賴規格表。[Impinj RAIN RFID technology](https://www.impinj.com/products/technology/how-do-rain-rfid-systems-work)、[Impinj deployment and best practices](https://support.impinj.com/hc/article_attachments/25550308409875)

對金屬／液體，供應商可以提供 on-metal／near-field tag；Avery Dennison 的資料表例如宣稱特定 on-metal UHF tag 在金屬表面可達 4–5 m，但同一文件也說明這是特定 tag、特定表面與特定條件的產品性能，不是一般 UHF tag 的保證。[Avery Dennison AD 2Metal Rock M781](https://rfid.averydennison.com/content/dam/rfid/en/products/rfid-products/data-sheets/datasheet-2Metal-Rock-M781.pdf)

### 5.4 RFID 控制點的安全與流程設計

RFID EPC／TID 是可被 reader 讀取的識別資料。GS1 Gen2v2／v3 提供選擇、存取與部分密碼學能力，但是否使用、tag 是否支援、reader 是否實作，必須逐項確認；不能把「符合 EPC Gen2」等同「不可複製」。[GS1 RFID standards](https://www.gs1.org/standards/rfid)、[GS1 EPC Gen2 standard repository](https://ref.gs1.org/standards/gen2/)

若將 RFID 用於本系統，建議採以下模型：

- RFID 僅回傳 opaque asset identifier；已登入人員由 server 用 JWT、據點 membership、角色與當下狀態重新授權。
- 匿名動作不要直接信任 RFID EPC／UID。可用 RFID 只做公開 asset locator，再由 kiosk／手機發起一次性短期 transaction challenge；若必須保持離線或無 App，QR bearer 應繼續作 fallback。
- UHF 控制點採固定短讀距／近場天線、低功率與明確讀取區；每個命令要求「預期只有一個 tag」，若回傳 0 個或多個就拒絕並顯示人工確認，而不是猜最強訊號。
- 連續讀取要以時間窗、去重與 server idempotency 防止同一 EPC 多次推進；不可把 RSSI 當作精確距離或資產所在位置的證明。
- 裝車流程應沿用「逐一掃來源車」與批次 scope；RFID 的一次多標籤能力不能變成把多台車自動合併的捷徑。

**推薦定位**：若未來要做 RFID，先從「洗衣車／車籠盤點、布品流向、出入口統計」開始；不要第一階段就把 UHF reader 接到洗衣機開始／完成這類高風險狀態變更。對單一設備控制，QR 或 HF 近場 reader 更容易驗收。

## 6. 方案四：BLE beacon／按鈕／平板 kiosk

### 6.1 BLE beacon：適合提示，不適合單獨觸發交易

BLE beacon 會廣播識別資料，手機／App 以掃描、region monitoring 或 ranging 判斷「附近」。Apple 的 iBeacon 文件把流程拆成兩階段：先用 region monitoring 發現 beacon，再用 ranging 判斷相對 proximity；文件明確說 ranging 只提供 far／near／immediate 等相對值，不是精確距離，也不應自行用訊號強度推算精確距離。[Apple determining proximity to an iBeacon](https://developer.apple.com/documentation/corelocation/determining-the-proximity-to-an-ibeacon-device)

Android 官方 BLE 文件則指出，Android 12 起需要 `BLUETOOTH_SCAN`／`BLUETOOTH_CONNECT` 等權限；背景掃描需要應用程式程序仍存活，若要在程序未執行時收到符合條件的掃描，可用 PendingIntent，但背景連線、foreground service、電池與啟動限制仍須處理。[Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)、[Android BLE background communication](https://developer.android.com/develop/connectivity/bluetooth/ble/background)

Apple Core Location／Core Bluetooth 同樣不是「網頁自動知道人站在哪台機器旁」的保證：beacon region monitoring 需要 location authorization／background mode；Core Bluetooth 背景執行受系統資源管理與 App 狀態限制。[Apple Core Location](https://developer.apple.com/documentation/corelocation)、[Apple Core Bluetooth](https://developer.apple.com/documentation/corebluetooth)

所以 BLE beacon 的安全／流程結論是：

- 可用來把目前工作站預選、顯示「你可能在洗衣機 A 旁」、減少選單操作。
- 不可用 beacon ID、MAC、UUID 或 RSSI 直接授權洗衣單狀態變更；廣播資料可被觀察、複製或重播，RSSI 會因人體、金屬、牆面與手機方向變動。
- 不宜設計成「進入附近範圍就自動開始清洗／完成烘乾」。應至少要求前景 App、明確 user gesture、預期資產核對與 server transaction。

### 6.2 BLE 按鈕：適合作業站 shortcut，不是資產憑證

一個實體按鈕可將「完成目前畫面上的確認」縮成按一下，特別適合戴手套、手上搬運衣物的洗衣員。技術上，Android 可用 BLE scanner／GATT 或 Bluetooth HID；Apple Core Bluetooth 的模型則是 central 掃描、連線、探索 service／characteristic，並訂閱 characteristic notification。[Android BluetoothLeScanner](https://developer.android.com/reference/android/bluetooth/le/BluetoothLeScanner)、[Android Bluetooth HID](https://developer.android.com/reference/android/bluetooth/BluetoothHidDevice)、[Apple Core Bluetooth central tasks](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/PerformingCommonCentralRoleTasks/PerformingCommonCentralRoleTasks.html)

導入時要區分兩種：

- **工作站按鈕**：按鈕只代表「此操作員要確認目前已選取批次／設備」，資產身份仍由 QR／NFC／RFID 或目前固定工作站 session 提供。這是最實際、最少資產維護的方式。
- **每台車／每台設備一顆 BLE 按鈕**：按鈕同時是識別器，會帶來電池、配對、遺失、替換、重複廣播、跨裝置連線與被複製的風險；若靠 proximity 判斷是哪台設備，會重現 beacon 的誤判問題。

BLE 按鈕不能在一般手機 Web 頁面上假設「免開 App、免配對、背景穩定接收」；比較可靠的架構是固定 Android PDA／kiosk 原生薄殼，連線只在需要時維持，事件進入前景受控操作頁，並由 server 再檢查 JWT／scope／狀態／冪等。Apple 的背景 Bluetooth 文件也提醒，背景掃描會合併廣播事件、掃描頻率會變慢，且 App 不會無限期執行。[Apple Core Bluetooth background processing](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)

### 6.3 平板 kiosk：把手機與個人狀態移到固定工作站

固定平板／Android kiosk 能把登入 session、目前工作站、掃碼器、按鈕與回饋固定在一個位置。Android Enterprise 的 dedicated device／lock task mode 可將裝置鎖在 allowlisted app，限制回到 home、通知與其他 App，適合送洗櫃台、設備旁或裝車站。[Android dedicated devices overview](https://developer.android.com/work/dpc/dedicated-devices)、[Android lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode)

推薦組合：

- **櫃台 kiosk**：固定平板 + 桌面 2D scanner + 大按鈕。匿名人員仍以車卡 QR 識別；掃描器讓操作員不必拿手機對焦，kiosk 負責顯示「送單／取件」確認。
- **設備 kiosk**：每台設備一台小型固定 terminal，設備身份由安裝時綁定的 server configuration／近場 tag 提供；內部洗衣員登入後按實體按鈕或掃批次 QR。不要讓「只要有人靠近」自動推進。
- **裝車 kiosk**：固定 terminal + scanner；逐一掃來源車／批次，畫面同時顯示預期車號與已讀車號，遇到多標籤或不在 scope 立即拒絕。

**導入風險**：需要供電、Wi‑Fi／行動網路、MDM／Android Enterprise 設定、螢幕清潔、設備防盜、共用登入／交班、離線策略、更新窗口與故障 fallback。kiosk 不是把安全移除，而是把「人員手機的可變狀態」換成「固定裝置的管理責任」；若 kiosk session 長期不登出，必須設計 session expiry、交班重新驗證與異常撤銷。

## 7. 對既有 QR bearer 安全模型的影響矩陣

| 方案 | 讀到的資料通常是什麼 | 能否作匿名授權 | 主要安全風險 | 建議安全邊界 |
| --- | --- | --- | --- | --- |
| QR | 可包含不可猜測 bearer URL／token | 可以，這是目前設計 | token 被拍照、轉傳、落入 history／storage／log；掃錯資產 | 保持 fragment → memory-only → POST；server 驗證 credential／scope／狀態／限流／冪等 |
| 專用 2D scanner | QR raw value | 可以 | keystroke 送進錯 App／網址列；scanner profile 被改 | explicit intent + package/signature；kiosk；raw token 不落 log／storage |
| NFC NDEF | 可讀 URI、文字、tag data | 不應直接可以 | 可讀／可寫／可複製；手機與 Web 支援不一致 | 只作 locator；已登入流程用 JWT 授權；匿名流程另發短期 transaction credential |
| NFC UID／ISO tag ID | tag identifier／UID | 不應直接可以 | identifier 不是 secret，可能被複製或偽造；不同 tag／reader 支援差異 | server-side asset lookup + authenticated user／challenge |
| HF RFID | 近場 tag ID，多可 anti-collision | 不應直接可以 | tag 被複製；鄰近多 tag；安裝材料影響漏讀 | 受控近場 zone + expected-one check + server auth |
| 被動 UHF RFID | 一次 inventory 的一個或多個 EPC／TID | 不應直接可以 | 遠距誤讀、漏讀、金屬／水／布料、讀取區超出直覺 | 僅盤點或受控 station；多 tag 拒絕；server auth／idempotency |
| BLE beacon | 廣播 ID／proximity／RSSI | 不應直接可以 | 可觀察／重播；訊號不等於位置或意圖；背景限制 | 預選／提示，不直接 mutation |
| BLE button | 按壓事件，可能來自已配對裝置 | 不應單獨可以 | 配對／連線／電池／背景事件、按鈕被移動或替換 | 工作站 shortcut；搭配 authenticated session 與目前資產 context |
| kiosk | 固定裝置的前景 App／reader input | 可，但由 kiosk session + QR／challenge 決定 | 共用 session、裝置被竄改、網路／供電故障 | MDM／lock task、session expiry、明確交班與 QR fallback |

### 7.1 保留 QR bearer 時的最低共同原則

1. **輸入設備不是授權設備。** 相機、scanner、NFC reader、RFID reader、BLE 或按鈕只產生「候選資產／候選 credential」；最後授權仍在 server-only DAL／RPC／RLS。
2. **不要把永久 bearer 搬進新媒介就宣稱安全性相同。** NDEF、EPC、BLE 廣播與 scanner 輸出都可能被讀出、記錄或重播；QR 的安全性來自不可猜測 credential + 伺服器驗證 + 受控傳送，不是來自黑白圖案本身。
3. **識別與意圖要分離。** 對已登入人員，可以用 tag ID 找到資產，再由 JWT scope 決定可做什麼；對匿名人員，必須保留 QR bearer 或新增明確的一次性交易授權，不要以「在附近」或「讀到 UID」自動完成交易。
4. **高風險 mutation 必須有明確確認。** 收單、開始／完成設備階段、裝車、取件都不可只因為背景讀到 tag／beacon 就推進；要顯示實體名稱／狀態、讓操作者確認，並由 RPC 做鎖定、冪等與狀態機檢查。
5. **所有新 reader 都要有安全 fallback。** QR 是最容易人工核對、最容易替換且目前匿名相容性最高的 fallback；新媒介失效時，不能改成讓人手動輸入資料庫 ID 或繞過 scope。

## 8. 建議的分階段導入路線

### Phase 0：先建立現場基準

不改資料庫與交易語意，記錄現有手機 QR 流程：首次成功率、p50／p95 完成時間、失敗原因、重複請求、錯車率、不同手機／光線／濕手套與清潔後 QR 卡壽命。這份基準是之後判斷設備是否真的改善的必要條件。

### Phase 1：QR 輸入升級（首選）

- 匿名送單／取件：保留手機 QR，改善卡片、放置、頁面與操作提示。
- 內部洗衣員：試點 1–2 款 Android PDA 整合 2D scanner；DataWedge／等效輸出只送到受控 App；讓既有 QR token 進入同一個 server endpoint。
- 固定櫃台／裝車站：試點桌面 2D scanner + Android kiosk／平板；保留人工 QR fallback。
- 驗收：至少要求掃描成功率、錯車率、重複提交率與「token 不落不當 storage／log」達到現況或更好，才擴大採購。

### Phase 2：NFC 輔助（只給內部已登入流程）

以一個洗衣站或設備區做 Android native／受控 PDA PoC：NFC 只回傳 asset locator，登入 session 決定 scope；同一資產並印 QR，NFC 失效時可立即改掃 QR。先不碰匿名送單／取件，也不把 NDEF 當秘密。

### Phase 3：RFID 盤點，再評估控制點

先選洗衣車／車籠或布品盤點，測量多 tag inventory 的 precision／recall、讀取區邊界、金屬／濕布／人體遮蔽、tag 壽命、reader 位置與功率。只有能在「預期一個 tag」情境穩定拒絕 0／多 tag，才考慮把 HF／UHF 接到控制點；高風險 mutation 仍保留 QR／人工確認。

### Phase 4：固定 kiosk + 按鈕／beacon

若現場主要痛點是手機拿取、手套與交班，而不是識別本身，優先上固定 kiosk + scanner + 實體按鈕。BLE beacon 只做目前工作站預選／提醒；不要把自動 proximity 變成狀態機觸發器。正式 kiosk 要納入 MDM、session expiry、停電／斷網／設備被移動的復原演練。

## 9. PoC 驗收清單

### 操作

- 從拿起設備到 server 回應的 p50／p95。
- 首次讀取成功率、重試次數、戴手套成功率。
- 低光、逆光、濕卡、髒卡、透明保護膜、彎曲卡面、金屬車體與鄰近資產。
- 操作者是否能在不看複雜說明下辨識「目前車／設備」與「目前可做動作」。
- 網路中斷、App 被切到背景、裝置重啟、電量低、scanner／reader 斷線與交班。

### 正確性與領域

- 每次 trigger 是否只對應一個預期資產；RFID 多 tag 是否拒絕而不是猜測。
- 跨機構／跨據點 credential 或 tag 是否被 server 拒絕。
- 同一事件重送、快速連按、reader 重複回報是否只產生一次效果。
- 錯誤角色、錯誤設備類型、錯誤狀態是否維持既有 reason code／狀態機邊界。
- 裝車是否仍逐一核對 `laundry_batch_sources`，不因 RFID 多讀而改變領域規則。

### 安全與隱私

- raw QR bearer、NDEF、EPC、BLE event 是否出現在 URL query／path、browser history、localStorage／sessionStorage、console、分析事件、crash report、reader log 或稽核文字。
- scanner intent 是否限定到正確 package／簽章；kiosk 是否禁止離開 allowlisted app。
- NFC／RFID／BLE tag 被複製、重播、替換或移到另一資產時，是否只能得到拒絕，而不能直接變更洗衣單。
- 匿名端點是否仍保留 rate limit、冪等、QR／challenge 驗證，且不回傳歷史或跨 scope 資料。
- 維修、換卡、停用與重發是否能撤銷舊 credential／tag mapping 並留下不可變稽核。

## 10. 最終建議

如果目標是「讓目前用手機刷 QR 的人少一點操作」，先選 **QR + 專用 2D scanner／Android PDA／固定 kiosk**。這是最容易把硬體效益直接接到現有流程、又不改變匿名 bearer 安全邊界的路徑。

如果目標是「像門禁卡一樣碰一下」，可評估 **HF／NFC 作為已登入內部流程的 asset locator**；不要把手機 Web NFC 的支援範圍或 tag UID 當成跨平台匿名授權方案。

如果目標是「一次辨識很多衣物／車籠」，才評估 **UHF RFID**。它的價值是無視線、多標籤與盤點效率；它的工程難度也正來自無視線、多標籤與讀取範圍。對單筆洗衣控制點，先選近場受控讀取或維持 QR。

如果目標是「減少戴手套時看手機」，評估 **固定 kiosk + 實體按鈕 + scanner**；BLE beacon 僅作提示／預選，不能直接取代明確的 asset confirmation 與 server authorization。

總體上，建議採 **QR 作為匿名與故障 fallback、PDA／kiosk 作為內部高頻入口、NFC 作為近場輔助、RFID 作為盤點層、BLE 作為工作站 UX 輔助** 的分層架構，而不是尋找一種媒介同時承擔識別、距離、意圖與授權。

## 11. 來源索引（官方／第一方）

### 專案 authoritative 文件

- [CONTEXT.md](../../CONTEXT.md)
- [docs/requirements.md](../requirements.md)
- [README.md](../../README.md)
- [src/app/scan/pending-qr-token.ts](../../src/app/scan/pending-qr-token.ts)

### QR／掃碼設備

- [Google ML Kit: Scan barcodes with ML Kit on Android](https://developers.google.com/ml-kit/vision/barcode-scanning/android)
- [Zebra DataWedge: About DataWedge](https://techdocs.zebra.com/datawedge/latest/guide/about/)
- [Zebra DataWedge: Barcode Input](https://techdocs.zebra.com/datawedge/latest/guide/input/barcode/)
- [Zebra DataWedge: Intent Output](https://techdocs.zebra.com/datawedge/latest/guide/output/intent/)
- [Zebra DataWedge: How Do I scan barcodes](https://techdocs.zebra.com/datawedge/latest/guide/programmers-guides/how-do-i/)
- [Zebra TC22／TC27 product overview brochure](https://www.zebra.com/content/dam/zebra_dam/en/brochure/portfolio/tc22-tc27-brochure-product-overview-en-us.pdf)

### NFC／ISO 14443／手機限制

- [NFC Forum: NFC Technology](https://nfc-forum.org/learn/nfc-technology/)
- [NFC Forum: NDEF Technical Specification](https://nfc-forum.org/build/specifications/data-exchange-format-ndef-technical-specification/)
- [ISO／IEC 14443-1:2018](https://www.iso.org/standard/70170.html)
- [ISO／IEC 14443-3:2018](https://www.iso.org/standard/70171.html)
- [ISO／IEC 14443-4:2018](https://www.iso.org/standard/70172.html)
- [Android: Near field communication overview](https://developer.android.com/develop/connectivity/nfc)
- [Android: NFC basics](https://developer.android.com/develop/connectivity/nfc/nfc)
- [Chrome for Developers: Interact with NFC devices on Chrome for Android](https://developer.chrome.com/docs/capabilities/nfc)
- [Apple: Core NFC](https://developer.apple.com/documentation/CoreNFC)
- [Apple: Adding support for background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading)
- [Apple: NFC Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/nfc)
- [Apple: `writeNDEF`](https://developer.apple.com/documentation/corenfc/nfcndeftag/writendef%28_%3Acompletionhandler%3A%29)

### RFID

- [GS1: EPC UHF Gen2 Air Interface Protocol](https://www.gs1.org/standards/rfid/uhf-air-interface-protocol)
- [GS1: System Architecture Document — EPC／RFID](https://www.gs1.org/standards/gs1-system-architecture-document/current-standard)
- [GS1: RFID standards](https://www.gs1.org/standards/rfid)
- [GS1: EPC Gen2 standard repository](https://ref.gs1.org/standards/gen2/)
- [Impinj: How do RAIN RFID systems work?](https://www.impinj.com/products/technology/how-do-rain-rfid-systems-work)
- [Impinj: Deployment Guide and Best Practices](https://support.impinj.com/hc/article_attachments/25550308409875)
- [HID: BluTAG HF Laundry Tag](https://www.hidglobal.com/products/blutag-hf-laundry-tag)
- [HID: LinTRAK Textile Tags](https://www.hidglobal.com/products/lintrak)
- [HID: Laundry Cage Tag](https://www.hidglobal.com/products/laundry-cage-tag)
- [Avery Dennison: AD 2Metal Rock M781 datasheet](https://rfid.averydennison.com/content/dam/rfid/en/products/rfid-products/data-sheets/datasheet-2Metal-Rock-M781.pdf)

### BLE／kiosk

- [Android: Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
- [Android: Communicate in the background](https://developer.android.com/develop/connectivity/bluetooth/ble/background)
- [Android: BluetoothLeScanner API](https://developer.android.com/reference/android/bluetooth/le/BluetoothLeScanner)
- [Android: BluetoothHidDevice API](https://developer.android.com/reference/android/bluetooth/BluetoothHidDevice)
- [Android: Dedicated devices overview](https://developer.android.com/work/dpc/dedicated-devices)
- [Android: Lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode)
- [Apple: Core Location](https://developer.apple.com/documentation/corelocation)
- [Apple: Determining the proximity to an iBeacon device](https://developer.apple.com/documentation/corelocation/determining-the-proximity-to-an-ibeacon-device)
- [Apple: Core Bluetooth](https://developer.apple.com/documentation/corebluetooth)
- [Apple: Performing common central role tasks](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/PerformingCommonCentralRoleTasks/PerformingCommonCentralRoleTasks.html)
- [Apple: Core Bluetooth background processing](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)
