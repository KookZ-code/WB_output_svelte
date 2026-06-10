# Wire Bond Output Monitor (SvelteKit Edition)

> Real-time production dashboard for monitoring Wire Bond machine output at a semiconductor assembly plant. Built with **SvelteKit 2 + Svelte 5 Runes**. The frontend is a **thin proxy** to the Rust/Axum **API center** ([Dashboad_API_rust](https://github.com/KookZ-code/Dashboad_API_rust)) — it holds no database driver. Re-skinned with the Microchip Industrial Light design system.

![Dashboard overview](docs/user-guide/screenshots/01-overview.png)

---

## Overview · ภาพรวม

ระบบ web dashboard สำหรับ Production Supervisor ใช้ติดตาม output ของเครื่อง Wire Bond แบบ real-time
เปรียบเทียบกับ target ของกะ และเจาะลึกถึงระดับ machine และ raw scan record

**สถาปัตยกรรมข้อมูล (ปัจจุบัน):** frontend ไม่ได้อ่าน database ตรงแล้ว — ทุก data ดึงผ่าน
**API center** (Rust/Axum, `Dashboad_API_rust`) ซึ่งเป็นตัวกลางไป SQLite `central.db` (hourly UPH)
และ MSSQL (utilization/events) · ฝั่ง frontend อ่านเฉพาะ **Excel plan** (`wb_plan.xlsx`) ในเครื่อง
สำหรับ plan target และดึง **WIP/DOI/Plan ต่อ package** จาก **assembly A01 API**

> เดิมโปรเจคนี้อ่าน `central.db` ตรงด้วย `better-sqlite3` — ถูก migrate มาเป็น proxy ผ่าน API center
> (logic การคำนวณ reset-aware delta / carry-over / shift window ย้ายไปอยู่ฝั่ง Rust แล้ว)

---

## Features

- **Live KPIs** — Total bonded · Achievement vs Target · Active machines · Active operators · Daily total
- **Cumulative chart** — Stacked bars per package + dashed target line + data labels (total + Δ% per hour)
- **Auto shift detection** — D 07:00–18:59 / N 19:00–06:59 (next day) เลือกอัตโนมัติตามเวลาจริง
- **Multi-select package filter** — search + presets
- **3-level drill-down** (single-page state preservation):
  1. คลิกแท่ง → package breakdown ของชั่วโมงนั้น (มีคอลัมน์ **WIP · DOI** จาก A01)
  2. คลิก package → machine table + utilization% + events + vs-target
  3. คลิก machine → raw scan records + events-in-shift
- **WIP / DOI columns** — WireBond-stage WIP และ Days-Of-Inventory จาก A01 API · DOI < 1 วัน = สีแดง
- **A01-sourced Plan/Shift** — Plan/Shift (และ Target/Missing/vs Pace) ดึงจาก A01 (plan ต่อวัน ÷ 2) สำหรับ package ที่ match · ที่เหลือ fallback Excel · เรียง package ตามลำดับ A01
- **Machine Monitor page** (`/monitor`) — scan-staleness (no_data/stale/active) + **operational Activity** (RUN/DOWN/IDLE/SETUP/SBO/CONV/PM) + **events-in-shift** pills + **Export CSV**
- **IDLE mode** — แยก SETUP-BY-OPERATOR ที่เป็น Idle/Wait ออกเป็นสถานะ IDLE (โผล่ทั้ง monitor, by-machine, records popup)
- **Auto-refresh** + status indicator
- **IIS-ready** — `sveltekit-adapter-iis` สร้าง `web.config` อัตโนมัติ
- **Microchip design system** — Open Sans, palette corporate

---

## Architecture

```
┌──────────────────────┐
│  Browser             │  Svelte 5 Runes + Chart.js 4.x
└──────────┬───────────┘
           │ fetch /api/{summary,hourly,packages,machines,records,monitor}
┌──────────▼───────────┐
│  SvelteKit server    │  +server.ts — thin proxy (no DB driver)
│  (mwGet + Excel plan)│  · middleware.ts → API center
└─────┬──────────┬─────┘
      │          │
      │          └────────────┐ (local read)
      │                       ▼
      │              ┌──────────────┐  ┌─────────────────────┐
      │              │ wb_plan.xlsx │  │ A01 API (assyapi)   │
      │              │ (XLSX_PATH)  │  │ WIP / DOI / Plan    │
      │              └──────────────┘  └─────────────────────┘
      ▼ (X-API-Key)
┌─────────────────────────────────────────────┐
│  API center — Rust/Axum  (API_BASE_URL)      │
│  /api/v1/wb-uph/*   → SQLite central.db       │
│  /api/v1/wb/report  → MSSQL (util + events)   │
└─────────────────────────────────────────────┘
```

**Frontend API routes** (proxy + plan/WIP overlay):

| Method | Path | Source |
| ------ | ---- | ------ |
| GET | `/api/summary?date=&shift=&packages=` | wb-uph/summary + Excel plan target |
| GET | `/api/hourly?date=&shift=&packages=` | wb-uph/hourly + Excel target line |
| GET | `/api/packages?date=&shift=&hour=` | wb-uph/packages + A01 WIP/DOI/Plan + plan merge |
| GET | `/api/machines?date=&shift=&hour=&package=` | wb-uph/machines + wb/report (util/events) + plan |
| GET | `/api/records?date=&shift=&machine_id=&package=` | wb-uph/records (passthrough) |
| GET | `/api/monitor?date=&shift=` | wb-uph/monitor + wb/report events |

---

## Tech Stack

| Layer | Library | Why |
| ----- | ------- | --- |
| Framework | SvelteKit 2 + Svelte 5 | Runes reactivity, file-based routes |
| Language | TypeScript (strict, no `any`) | Type safety end-to-end |
| Data | **API center** (Rust/Axum) via `mwGet` | No DB driver in frontend |
| Excel | `xlsx` (SheetJS) | Plan target read locally |
| Charts | `chart.js` 4.x | Custom plugins |
| Build | Vite 6 | SvelteKit default |
| Deploy | `sveltekit-adapter-iis` | Auto `web.config` for IIS |
| Design | DESIGN.md (Microchip Industrial Light) | Token source of truth |

---

## Prerequisites

- **Node.js 20+**
- **API center** (`Dashboad_API_rust`) รันอยู่ และเข้าถึงได้จาก `API_BASE_URL` (ปกติ `http://localhost:8080`)
- `wb_plan.xlsx` — แผนการผลิต (server อ่านได้ที่ `XLSX_PATH`)
- (optional) **A01 API** (`WIP_API_URL`) สำหรับคอลัมน์ WIP/DOI และ Plan/Shift

---

## Installation

```bash
git clone https://github.com/KookZ-code/WB_output_svelte.git
cd WB_output_svelte
npm install
cp .env.example .env   # แล้วแก้ค่า
npm run check          # type-check ต้องผ่าน 0 errors
```

### `.env`

```env
ORIGIN=http://localhost:3000
BASE_PATH=
NODE_ENV=production
PORT=3000

# API center (middleware ระหว่าง frontend กับ DB) — server-only, ห้ามใส่ VITE_
API_BASE_URL=http://localhost:8080
API_KEY=
API_TIMEOUT=10000

# WIP source — assembly A01 API (WireBond WIP/DOI/Plan ต่อ package)
WIP_API_URL=http://mth-vm-asoprd/assyapi/api/A01/pkgDOI

# Excel plan — frontend อ่านเองสำหรับ plan target / vs-target %
XLSX_PATH=./data/wb_plan.xlsx
```

> `API_BASE_URL` / `API_KEY` / `API_TIMEOUT` / `WIP_API_URL` มี fallback default ในโค้ด —
> ตั้งให้ชัดเจนตอน deploy โดยเฉพาะถ้า API center ไม่ได้อยู่เครื่องเดียวกัน

---

## Usage

```bash
npm run dev          # dev server (vite, default :5173)
npm run dev -- --host  # แชร์บน LAN
npm run build        # production build → build/ (+ web.config)
npm run preview      # preview production
npm run check        # svelte-check + tsc
npm run lint / format / test / test:e2e
```

ถ้าตั้ง `BASE_PATH=/myapp` → URL = `http://localhost:5173/myapp/`

---

## Deployment to IIS

ออกแบบมา deploy บน **IIS Windows Server** (iisnode + URL Rewrite)

```powershell
npm run build
# copy build/, package.json, .env ขึ้น server แล้ว npm install --production + iisreset
```

`.env` บน server:

```env
ORIGIN=http://<server-name>
BASE_PATH=/wbmonitor
API_BASE_URL=http://localhost:8080   # ชี้ API center (ปกติรันเครื่องเดียวกัน)
XLSX_PATH=\\file-server\share\wb\wb_plan.xlsx
WIP_API_URL=http://mth-vm-asoprd/assyapi/api/A01/pkgDOI
```

> API center ต้องรันด้วย (เป็น Windows Service แยก) และ IIS App Pool user ต้องอ่าน `XLSX_PATH` ได้

---

## Project Structure

```
WB_output_svelte/
├── src/
│   ├── app.css                          # Microchip design tokens
│   ├── lib/
│   │   ├── components/
│   │   │   ├── DashboardHeader.svelte
│   │   │   ├── PackageDropdown.svelte
│   │   │   ├── KpiCards.svelte
│   │   │   ├── MainChart.svelte         # Chart.js stacked bar + target line
│   │   │   ├── PackagePanel.svelte      # Drill 1 — packages (+ WIP/DOI, A01 order)
│   │   │   ├── MachineTable.svelte      # Drill 2 — machines (util/events/IDLE)
│   │   │   └── RecordsTable.svelte      # Drill 3 — raw records + events
│   │   ├── server/                      # SERVER-ONLY
│   │   │   ├── middleware.ts            # mwGet → API center ({data,error} envelope)
│   │   │   ├── wbReport.ts              # util/events overlay (API center wb/report)
│   │   │   ├── wip.ts                   # A01 WIP/DOI/Plan fetch + match + cache
│   │   │   ├── config.ts                # Env reader (XLSX_PATH)
│   │   │   ├── shift.ts                 # Shift window calc
│   │   │   ├── excel.ts                 # XLSX plan parser + name normalize
│   │   │   ├── plan-cache.ts            # Lazy plan singleton (mtime check)
│   │   │   └── handler-utils.ts         # resolveShift / parsePkgFilter / displayToDb
│   │   ├── stores/dashboard.svelte.ts   # $state runes — UI state
│   │   ├── types/{index,dashboard}.ts   # Domain types
│   │   └── utils/
│   │       ├── machineStatus.ts        # status + job pills + IDLE classification
│   │       ├── api.ts                   # client fetch wrapper
│   │       └── format.ts
│   └── routes/
│       ├── +page.svelte                 # Dashboard
│       ├── monitor/+page.svelte         # Machine Monitor (+ Export CSV)
│       └── api/{summary,hourly,packages,machines,records,monitor}/+server.ts
├── docs/ · DESIGN.md · CLAUDE.md · LICENSE
├── .env.example · package.json · svelte.config.js · tsconfig.json · vite.config.ts
```

> ไฟล์ที่ถูกลบตอน migrate: `server/db.ts`, `server/db-sync.ts`, `server/queries/*`
> (logic ย้ายไป API center) และถอด dependency `better-sqlite3`

---

## Domain Logic Notes

### Shift definitions
```
D shift = 07:00–18:59 (วันเดียวกัน)
N shift = 19:00 (วันก่อน) → 06:59 (วันนี้)
```

### Production calculation (ทำที่ API center แล้ว)
`bonded_unit` เป็น cumulative counter ต่อ (machine, lot) · ใช้ **reset-aware delta** รองรับ
capillary reset กลางล็อต + carry-over heuristic (implied UPH > reported × 2 → carry-over)
— logic ทั้งหมดอยู่ใน `wb_uph_repo.rs` ฝั่ง API center, frontend แค่รับตัวเลขดิบมา overlay plan

### IDLE classification
SETUP-BY-OPERATOR ที่ `des_job` มีคำว่า **Idle** หรือ **Wait** → จัดเป็น **IDLE** (แยกจาก SBO)
— logic อยู่ที่ `utils/machineStatus.ts` (`isIdle`) ใช้ร่วมทั้ง monitor / by-machine / records popup

### Package name resolution (A01 ↔ dashboard)
A01 ใช้ชื่อต่าง (`8L SOIC  IDF`, `20L VQFN 3x3(2LX)W`) จึง match 2 ทาง:
1. **MPC code** ในวงเล็บ — `20VQFN(2LX)` ↔ `(2LX)`
2. **Normalize ชื่อ** — ตัด `(...)`, `{n}L`, SOT-23, space → `8SOICIDF`
มี alias table สำหรับเคสที่ normalize ไม่ตรง (เช่น `8SOIJ`→`8L EIAJ`)

---

## User Guide

คู่มือสำหรับ Production Supervisor พร้อม screenshot อยู่ที่
[`docs/user-guide/`](docs/user-guide/) — เปิดด้วย browser หรือพิมพ์เป็น PDF

---

## Development Notes

ดู [CLAUDE.md](CLAUDE.md) — ห้ามใช้ `any` · ห้าม fetch ใน component · ห้าม hardcode · ทุก visual value จาก `DESIGN.md`

**Known gotchas**
- **Svelte 5 + Chart.js:** reactive proxies break `Object.defineProperty` → clone array ก่อนส่ง (`[...arr]`)
- **`{#each}` keys:** event pills key ด้วย index (event ซ้ำ t_start+job_type ได้ → ห้าม key ด้วยค่าซ้ำ)
- **API center ต้องรัน** — ถ้า `API_BASE_URL` เข้าไม่ถึง endpoint จะคืน 502; A01 ล่ม → WIP/DOI ว่าง, Plan fallback Excel (degrade ปกติ)

---

## License

[MIT](LICENSE)

---

## Acknowledgements

- **API center** ([KookZ-code/Dashboad_API_rust](https://github.com/KookZ-code/Dashboad_API_rust)) — Rust/Axum middleware
- **WB Dashboard original** ([KookZ-code/WB_Output_Monitoring](https://github.com/KookZ-code/WB_Output_Monitoring)) — Rust + Axum implementation เดิม
- **Microchip Industrial Light** design system

Built for internal use at a semiconductor assembly facility in Thailand.
