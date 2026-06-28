# Task 00 — 基础：数据模型 + 双人账号 + 邀请

> 依赖：无（第一个做）
> 这是护城河。先把它做对，后面所有功能都建在上面。

---

## 目标
建立数据层和双人共享账号机制：两个用户共享一场婚礼，任何一方都能编辑任何内容。

---

## 范围（要做）

### 1. 数据模型（核心）
为 SEA 多仪式场景设计，**不要用西方单场默认模型**。

```
User            id, name, email/认证字段
Wedding         id, date, total_budget, size_estimate, created_by
WeddingMember   wedding_id, user_id   （把 2 个用户连到 1 场婚礼）
Ceremony        id, wedding_id, name, type, date
                （多场：akad nikah / 晚宴 / 茶礼 等）
Task            id, wedding_id, ceremony_id(可空), title,
                due_date 或 due_offset, group(now/soon/later),
                status, assignee(可空)
BudgetItem      id, wedding_id, category, planned_amount, actual_amount,
                type(expense / income)
                （income 类型用于红包 / ang pow 追踪）
Guest           id, wedding_id, name, status(invited/confirmed/declined)
GuestCeremony   guest_id, ceremony_id   （多对多：宾客关联多场仪式）
Invite          token, wedding_id, expires_at
Note            id, wedding_id, content  （P1，可先建表后用）
```

### 2. 认证 + 双人账号
- 用户注册 / 登录。
- 创建婚礼 = 自动成为第一个 WeddingMember。
- **共享所有权：** 两个成员权限完全相同，无角色 / 权限墙。

### 3. 邀请流程
- 主导者生成**一个可分享链接**（Invite token）。
- 被邀请方点链接 → **无需先注册即可查看邀请内容**（降低懒伴侣门槛）。
- 接受邀请后注册 / 登录 → 成为第二个 WeddingMember。

---

## 完成标准
- [ ] 用户 A 能创建一场婚礼，含至少 2 场仪式
- [ ] 用户 A 生成邀请链接，用户 B 通过链接加入同一场婚礼
- [ ] 用户 A 和 B 看到的是**同一份数据**，任一方编辑后另一方刷新可见
- [ ] 数据模型支持：一场婚礼多仪式、一个宾客关联多仪式、预算项区分支出 / 红包收入

---

## 不做（护栏）
- 不做角色 / 权限分级
- 不做家人 / 宾客登录
- 不做复杂的协同冲突处理（last-write-wins 即可）
