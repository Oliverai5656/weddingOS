# O&S 婚礼 Dashboard

这是 O&S 自用的华人婚礼更新与追踪 dashboard，包含共享用户、邀请链接、仪式、待办、预算、红包收入和宾客追踪。

## Run

```powershell
npm start
```

打开：

```text
http://localhost:4173
```

## 已完成

- 本机用户建立 / 登入。
- O&S 婚礼 dashboard。
- 两人共享同一份婚礼资料。
- 伴侣邀请链接，登入前可先看摘要。
- 资料可存在 `data/db.json`，也可切换到 Supabase。
- 华人婚礼仪式、待办、预算、红包收入、宾客与仪式关联。

## 构建顺序

1. `Task 00` 基础数据与共享账号。
2. `Task 01` 引导与自动生成。
3. `Task 02` Dashboard / 今日追踪。
4. `Task 03` 清单与预算工作面。
5. `Task 04` 宾客名单。

首次使用只需要回答三个核心问题：

- 婚礼日期
- 总预算
- 预计宾客人数

系统会生成：

- 华人婚礼仪式，例如接亲、敬茶、婚宴、回门。
- 按 `now / soon / later` 分组的待办。
- 与仪式关联的待办。
- 支出总额对齐输入预算的预算骨架。
- 用于红包追踪的 `income` 预算项。

## Supabase Backend

这个项目不是 Next.js app，所以不使用 Supabase quickstart 里的 `page.tsx` 和 middleware。当前 app 使用本机 Node server，并通过 `DATA_BACKEND` 切换储存方式。

1. 安装 packages：

```powershell
npm install
```

2. 打开 Supabase Dashboard > SQL Editor，执行：

```text
supabase/schema.sql
```

3. 编辑 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://impczlmdfxkgtyqtmcko.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
DATA_BACKEND=supabase
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

4. 重启 server：

```powershell
npm start
```

5. 确认 backend：

```text
http://localhost:4173/api/health
```

应看到：

```json
{ "ok": true, "backend": "supabase" }
```

不要把 `SUPABASE_SERVICE_ROLE_KEY` 放进浏览器代码。它只能放在本机 Node server 使用。
