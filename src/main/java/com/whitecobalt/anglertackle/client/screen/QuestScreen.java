package com.whitecobalt.anglertackle.client.screen;

import com.whitecobalt.anglertackle.client.ClientQuests;
import com.whitecobalt.anglertackle.network.QuestPayload;
import com.whitecobalt.anglertackle.player.QuestData;
import com.whitecobalt.anglertackle.quest.QuestDef;
import com.whitecobalt.anglertackle.quest.QuestGoal;
import com.whitecobalt.anglertackle.quest.QuestPool;
import com.whitecobalt.anglertackle.quest.QuestTiers;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * **老柯的委托**面板（策划 `docs/40` §9；用户 2026-10-14："任务 ui 界面策划"）。
 *
 * <h2>版面（470×224，与 `TitleScreen` / `MailScreen` 同档，走 {@code UiLayout}）</h2>
 * <pre>
 * ┌─ 老柯的委托 ───────────────── 活跃度 62 / 100 ─┬─ 详情 ─────────────┐
 * │ 25○  50○  75●  100○        本周还剩 4 游戏日    │ 钓到 3 条绿色以上的鱼│
 * │ ─────────────────────────────────────────────  │ 进度  1 / 3         │
 * │ [每日]  今日还剩 8 分钟                          │ ███░░░░░░░░         │
 * │ ▎钓到 5 条鱼                          2 / 5    │ 奖励  45 鱼币        │
 * │ ▎钓到 3 条绿色以上的鱼                已完成 ✔  │ 期限  本游戏日结束   │
 * │ [周常]  本周还剩 4 游戏日                        │ 状态  奖励已寄到邮箱 │
 * │ ▎集齐鲫鱼、罗非鱼、鲻鱼各 1 条          1 / 3    │                     │
 * └──────────────────────────────[ 完成 ]─────────┴─────────────────────┘
 * </pre>
 *
 * <h2>三条纪律（都照既有界面）</h2>
 * <ol>
 *   <li><b>文字全走 {@link TextWidget}</b>（不能 {@code graphics.drawString}）——
 *       用户环境里同时装了 TACZ / 森罗等模组，自绘文字会糊，只有走 widget 渲染路径才清晰；</li>
 *   <li><b>不调 {@code super.render()}</b>（它内部会再调一次 {@code renderBackground}，
 *       那层全屏暗化会盖在面板上 ⇒ 界面发灰）—— 手动遍历 {@code renderables} 渲染 ✓
 *       （守着这条的是 {@code tools/check-screen-render.js}）；</li>
 *   <li><b>只读</b>：这个界面一个写操作都没有（接取走邮件按钮、领取走邮箱）——
 *       客户端只负责"把服务端推来的快照画出来" ✓。</li>
 * </ol>
 *
 * <h2>为什么这里读 {@code QuestPool} 而不等服务端把文案发过来</h2>
 * 名字要**按客户端语言**翻（{@code quest.anglertackle.<id>.name}），而目标 / 奖励本来就是
 * 纯表（{@code QuestPool} / {@code QuestDef} 不碰任何服务端类型）⇒ 客户端直接读表，
 * **单位口径就与判定共用一份**（`QuestGoal.display`）—— 服务端一个中文字都不发 ✓。
 *
 * <h2>悬浮提示（1.6.4 用户验收后加）</h2>
 * 鼠标放到**活跃度行 / 列表行 / 详情栏奖励行**上会弹出说明（各档奖励、委托奖励与状态、
 * 原版物品说明）—— 三处命中框与渲染布局逐字一致，写法照 {@code MailScreen.renderHoverTips} ✓。
 */
public class QuestScreen extends Screen {

    // ------------------------------------------------------------------ 版面常量
    private static final int PANEL_W = 470;
    private static final int PANEL_H = 224;
    private static final int MIN_W = 260;
    private static final int MIN_H = 160;
    private static final int HEADER_H = 18;
    /** 活跃度条那一行的高度。 */
    private static final int ACTIVITY_H = 18;
    /** "每日 / 周常"分组小标题的高度。 */
    private static final int GROUP_H = 10;
    private static final int LIST_ROW_H = 14;
    private static final int LIST_W = 236;
    private static final int FOOTER_H = 24;
    private static final int GAP = 6;
    /** 列表行左侧那道 3px 色带（一眼分出每日 / 周常）。 */
    private static final int BAR_W = 3;
    private static final int BTN_H = 18;
    private static final int BAR_THICK = 4;

    // ------------------------------------------------------------------ 配色（整套照 TitleScreen，不许另起色板）
    private static final int C_TITLE = 0xFFFFD050;
    private static final int C_LABEL = 0xFF8FCBF5;
    private static final int C_TEXT = 0xFFE8E8E8;
    private static final int C_DIM = 0xFFB0B0B0;
    private static final int C_HINT = 0xFF909090;
    private static final int C_PANEL = 0xFF243028;
    private static final int C_SHADOW = 0xF0000000;
    private static final int C_LINE = 0xFF5A6A60;
    private static final int C_TRACK = 0xFF3A4A40;
    private static final int C_SEL = 0x40FFFFFF;

    private final List<Button> buttons = new ArrayList<>();
    private final List<TextWidget> texts = new ArrayList<>();

    private int panelW = PANEL_W;
    private int panelH = PANEL_H;
    private int left;
    private int top;

    /** 选中的委托 id（空串 = 没选）。 */
    private String selectedId = "";

    public QuestScreen() {
        super(Component.translatable("gui.anglertackle.quest_board"));
    }

    // ------------------------------------------------------------------ 生命周期
    @Override
    protected void init() {
        // ★ 面板必须装得进窗口（同 CodexScreen / MailScreen / TitleScreen）
        panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
        panelH = UiLayout.panelH(this.height, PANEL_H, MIN_H);
        this.left = (this.width - panelW) / 2;
        this.top = (this.height - panelH) / 2;
        rebuild();
    }

    /** 服务端又推了一份快照（界面已经开着）⇒ 就地重建 —— 不要重新 setScreen（会闪、会丢选中）。 */
    public void refresh() {
        rebuild();
    }

    private QuestPayload snap() {
        return ClientQuests.latest();
    }

    // ------------------------------------------------------------------ 数据行
    /** 一行已接委托的解析结果（**只读投影**，字段顺序与 `QuestPayload` 的行格式逐字对应）。 */
    private static final class Row {
        String id = "";
        int progress;
        boolean claimed;
        QuestDef def;
        boolean daily;
        String name = "";
    }

    /** 解析快照（坏行直接跳过：界面宁可少一行，也不要崩）。 */
    private List<Row> parse() {
        QuestPayload snap = snap();
        List<Row> out = new ArrayList<>();
        if (snap == null) {
            return out;
        }
        for (String line : snap.rows()) {
            String[] f = line.split("\\|", -1);
            if (f.length < 3) {
                continue;
            }
            QuestDef def = QuestPool.byId(f[0]);
            if (def == null) {
                continue;   // 客户端不认识这个 id（版本不一致）⇒ 不画
            }
            int prog;
            try {
                prog = Integer.parseInt(f[1]);
            } catch (NumberFormatException e) {
                continue;
            }
            Row r = new Row();
            r.id = f[0];
            r.progress = prog;
            r.claimed = "1".equals(f[2]);
            r.def = def;
            r.daily = def.period() == QuestDef.Period.DAILY;
            r.name = tr("quest.anglertackle." + def.id() + ".name");
            out.add(r);
        }
        // 每日在前、周常在后（与面板上的分组一致；表序本来就分好了，这里只是兜底）
        out.sort((a, b) -> Boolean.compare(b.daily, a.daily));
        return out;
    }

    /** 面板上要画的那份（每日在前 + 周常在后），分组标题由 {@link #rebuild()} 插。 */
    private List<Row> rows() {
        return parse();
    }

    private Row selected() {
        for (Row r : rows()) {
            if (r.id.equals(selectedId)) {
                return r;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ 坐标
    private int listX() {
        return left + 6;
    }

    private int listTop() {
        return top + HEADER_H + ACTIVITY_H;
    }

    private int detailX() {
        return left + 6 + LIST_W + GAP;
    }

    private int detailW() {
        return panelW - (6 + LIST_W + GAP) - 6;
    }

    /** 列表行在屏幕上的 y（{@code visualIndex} 是**含分组标题**的序号）。 */
    private int rowY(int visualIndex) {
        return listTop() + visualIndex * LIST_ROW_H;
    }

    // ------------------------------------------------------------------ 重建
    private void clearAll() {
        for (Button b : buttons) {
            this.removeWidget(b);
        }
        buttons.clear();
        for (TextWidget w : texts) {
            this.removeWidget(w);
        }
        texts.clear();
    }

    private void rebuild() {
        clearAll();
        QuestPayload snap = snap();
        int by = top + panelH - FOOTER_H + 3;

        // ---- 标题栏 ----
        addText(left + 6, top + 5, tr("gui.anglertackle.quest_board"), C_TITLE, panelW - 120);
        if (snap != null) {
            addTextRight(left + panelW - 6, top + 5,
                    tr("gui.anglertackle.quest_activity", snap.activity(), snap.cap()),
                    snap.activity() >= snap.cap() ? C_TITLE : C_LABEL);
        }

        // ---- 页脚 ----
        Button done = Button.builder(Component.translatable("gui.anglertackle.quest_close"),
                        b -> this.onClose())
                .bounds(left + panelW - 6 - 60, by, 60, BTN_H).build();
        addRenderableWidget(done);
        buttons.add(done);
        int hintX = left + 6;
        int hintAvail = (left + panelW - 6 - 60 - 6) - hintX;
        if (hintAvail > 40) {
            addText(hintX, top + panelH - FOOTER_H + 8,
                    tr("gui.anglertackle.quest_tip_pick"), C_HINT, hintAvail);
        }

        if (snap == null) {
            // 还没收到快照 —— 画"读取中"，**不画空列表**（同 CodexScreen / TitleScreen 的理由）
            addText(listX() + 6, listTop() + 8, tr("gui.anglertackle.quest_loading"), C_DIM, LIST_W - 12);
            return;
        }

        // ---- 活跃度行：四档标记 + 本周剩余 ----
        List<Integer> tiers = snap.tierAt();
        StringBuilder marks = new StringBuilder();
        for (int i = 0; i < tiers.size(); i++) {
            boolean got = (snap.claimedTiers() & (1 << i)) != 0;
            if (i > 0) {
                marks.append("  ");
            }
            marks.append(tiers.get(i)).append(got ? " ●" : " ○");
        }
        addText(left + 6, top + HEADER_H + 2, marks.toString(), C_TEXT, LIST_W);
        addTextRight(left + panelW - 6, top + HEADER_H + 2,
                tr("gui.anglertackle.quest_week_left", snap.weeklyLeftDays()), C_DIM);

        // ---- 列表：每日在前、周常在后（空态照画 —— 用户点名的"板块常在"）----
        List<Row> list = rows();
        int y = listTop();
        if (list.isEmpty()) {
            addText(listX() + 6, y + 4, tr("gui.anglertackle.quest_empty"), C_DIM, LIST_W - 12);
            addText(listX() + 6, y + 4 + LIST_ROW_H,
                    tr("gui.anglertackle.quest_empty_hint"), C_HINT, LIST_W - 12);
            return;
        }
        boolean dailyHeaderDrawn = false;
        boolean weeklyHeaderDrawn = false;
        for (Row r : list) {
            if (r.daily && !dailyHeaderDrawn) {
                addText(listX() + 6, y + 2, tr("gui.anglertackle.quest_group_daily")
                        + "   " + tr("gui.anglertackle.quest_day_left", snap.dailyLeftMin()), C_LABEL, LIST_W - 12);
                y += GROUP_H;
                dailyHeaderDrawn = true;
            }
            if (!r.daily && !weeklyHeaderDrawn) {
                addText(listX() + 6, y + 2, tr("gui.anglertackle.quest_group_weekly"), C_TITLE, LIST_W - 12);
                y += GROUP_H;
                weeklyHeaderDrawn = true;
            }
            addText(listX() + 6 + BAR_W + 3, y + 3, r.name, r.claimed ? C_DIM : C_TEXT, LIST_W - 70);
            addTextRight(listX() + LIST_W - 6, y + 3, statusText(r), r.claimed ? C_HINT : C_LABEL);
            y += LIST_ROW_H;
        }

        // ---- 详情栏 ----
        Row sel = selected();
        if (sel == null) {
            return;
        }
        int dx = detailX();
        int dw = detailW();
        int dy = listTop() + 3;
        addText(dx + 4, dy, sel.name, sel.claimed ? C_DIM : C_TITLE, dw - 8);
        dy += 14;
        addText(dx + 4, dy, tr("gui.anglertackle.quest_detail_progress"), C_LABEL, 40);
        addText(dx + 44, dy, progressText(sel), sel.claimed ? C_DIM : C_TEXT, dw - 48);
        dy += 20;                                   // 进度条画在 render 里（这里留出高度）
        addText(dx + 4, dy, tr("gui.anglertackle.quest_detail_reward"), C_LABEL, 40);
        addText(dx + 44, dy, rewardText(sel.def), C_TEXT, dw - 48);
        dy += 14;
        addText(dx + 4, dy, tr("gui.anglertackle.quest_detail_deadline"), C_LABEL, 40);
        addText(dx + 44, dy, tr(sel.daily
                ? "gui.anglertackle.quest_deadline_daily"
                : "gui.anglertackle.quest_deadline_weekly"), C_TEXT, dw - 48);
        dy += 14;
        addText(dx + 4, dy, tr("gui.anglertackle.quest_detail_state"), C_LABEL, 40);
        addText(dx + 44, dy, statusText(sel), sel.claimed ? C_HINT : C_TEXT, dw - 48);
    }

    private static String tr(String key, Object... args) {
        return Component.translatable(key, args).getString();
    }

    /**
     * 加一行文字。
     *
     * <p>⚠ y 就是**实际画出来的那一行**的 y：{@link TextWidget} 内部会按 {@code (height - 8) / 2}
     * 再往下挪一点，所以这里先减掉那个偏移（与 `TitleScreen.addText` 逐字一致的做法）。
     */
    private void addText(int x, int y, String text, int color, int maxWidth) {
        if (text == null || text.isEmpty()) {
            return;
        }
        int w = Math.max(8, maxWidth);
        TextWidget widget = new TextWidget(x, y - 2, w, 12, UiLayout.fitText(text, w), color, true, 0, 0);
        addRenderableWidget(widget);
        texts.add(widget);
    }

    private void addTextRight(int right, int y, String text, int color) {
        int w = Minecraft.getInstance().font.width(text);
        addText(right - w, y, text, color, w + 2);
    }

    // ------------------------------------------------------------------ 文案
    /** 列表右侧 / 详情栏的状态：**"已完成" = 奖励信已经寄到你邮箱了**（不代表已领取）✓。 */
    private String statusText(Row r) {
        return r.claimed ? tr("gui.anglertackle.quest_state_done")
                : progressText(r);
    }

    /** 进度文案（**单位换算与判定共用 `QuestGoal`** —— 重量类的 progress 存的是 ×100 的整数）。 */
    private String progressText(Row r) {
        QuestData.Row row = new QuestData.Row(r.progress, r.claimed);
        double now = QuestGoal.display(r.def, row);
        double need = QuestGoal.displayTarget(r.def);
        return weightGoal(r.def)
                ? fmt(now) + " / " + fmt(need) + " kg"
                : (long) now + " / " + (long) need;
    }

    private static boolean weightGoal(QuestDef def) {
        return def.goal() == QuestDef.Goal.GET_WEIGHT_SUM || def.goal() == QuestDef.Goal.GET_BIGGEST;
    }

    private static String fmt(double v) {
        // ⚠ Locale.ROOT：某些语言环境的小数点是逗号，会让"1,5 / 3,0 kg"看着像千分位
        return String.format(Locale.ROOT, "%.1f", v);
    }

    /** 奖励文案（鱼币 **或** 物品，二选一 —— 定义表里写着给哪种）。 */
    private String rewardText(QuestDef def) {
        if (def.givesCoins()) {
            return tr("gui.anglertackle.quest_reward_coins", def.coins());
        }
        if (!def.givesItem()) {
            return tr("gui.anglertackle.quest_reward_none");
        }
        ItemStack st = stackOf(def.itemId(), def.itemCount());
        String itemName = st == null ? def.itemId() : st.getHoverName().getString();
        return tr("gui.anglertackle.quest_reward_item", itemName, def.itemCount());
    }

    /** 第 {@code bit} 档活跃度奖励的文案（读 {@link QuestTiers} —— 与服务端结算同一张表）。 */
    private static String tierRewardText(int bit) {
        if (QuestTiers.givesCoins(bit)) {
            return tr("gui.anglertackle.quest_reward_coins", QuestTiers.COINS[bit]);
        }
        if (QuestTiers.givesItem(bit)) {
            ItemStack st = stackOf(QuestTiers.ITEM[bit], QuestTiers.ITEM_COUNT[bit]);
            String itemName = st == null ? QuestTiers.ITEM[bit] : st.getHoverName().getString();
            return tr("gui.anglertackle.quest_reward_item", itemName, QuestTiers.ITEM_COUNT[bit]);
        }
        return tr("gui.anglertackle.quest_reward_none");
    }

    /**
     * 物品 id → {@link ItemStack}（认不出来返回 {@code null} —— 不猜、也不崩）。
     *
     * <p>奖励行悬浮提示要弹**原版物品说明**（{@code renderTooltip} 只认 {@link ItemStack}）⇒
     * 这里按 id 现做一个；名字解析与 {@link #rewardText} 是同一套（注册表查不到就退回显示 id）。
     */
    private static ItemStack stackOf(String itemId, int count) {
        try {
            Identifier rl = Identifier.tryParse(itemId);
            Item item = rl == null ? null : BuiltInRegistries.ITEM.get(rl);
            if (item != null && item != Items.AIR) {
                return new ItemStack(item, Math.max(1, count));
            }
        } catch (Throwable ignored) {
            // 认不出来就当我没说
        }
        return null;
    }

    /**
     * 第 {@code i} 个列表行的 y（**含分组标题占位**）。
     *
     * <p>⚠ 与 {@link #render} / {@link #mouseClicked} 里的行走必须是同一套布局 ——
     * 悬浮提示的命中框差一行，玩家就会觉得"提示时灵时不灵"。
     */
    private int rowYOf(int i) {
        int y = listTop();
        boolean dailyHeaderDrawn = false;
        boolean weeklyHeaderDrawn = false;
        int n = 0;
        for (Row r : rows()) {
            if (r.daily && !dailyHeaderDrawn) {
                y += GROUP_H;
                dailyHeaderDrawn = true;
            }
            if (!r.daily && !weeklyHeaderDrawn) {
                y += GROUP_H;
                weeklyHeaderDrawn = true;
            }
            if (n == i) {
                return y;
            }
            n++;
            y += LIST_ROW_H;
        }
        return y;
    }

    private static boolean inRect(double mx, double my, int x, int y, int w, int h) {
        return mx >= x && mx <= x + w && my >= y && my <= y + h;
    }

    // ------------------------------------------------------------------ 悬浮提示
    /**
     * 鼠标悬浮说明（用户 2026-10-14 验收原话："只能看到活跃度的进度但不会说明活跃度到后
     * 给什么奖励，包括任务奖励等应该也有这种问题"）。
     *
     * <p>三处，全部照 {@code MailScreen.renderHoverTips} 的范式，并且**放在 render 最后**
     * 画（盖在所有东西上面；守着这条的是 {@code tools/check-quest.js} 的 V 组）：
     * <ol>
     *   <li><b>活跃度行</b>（档位标记 + 进度条）：四档各给什么、领没领、还差多少；</li>
     *   <li><b>列表行</b>：这条委托的奖励 / 状态 / 期限（不用先点选中）；</li>
     *   <li><b>详情栏奖励行</b>：物品奖励弹**原版物品说明**，鱼币说明"奖励信发到邮箱"。</li>
     * </ol>
     */
    private void renderHoverTips(GuiGraphics g, int mouseX, int mouseY) {
        // ① 活跃度行：档位标记（HEADER_H+2）与进度条（+13~+17）罩一整行。
        //
        // ⚠ 2026-10-16 用户复验："任务界面的活跃奖励节点没有悬浮文本提示完成后有什么奖励"。
        //   原来的命中框是 `left+6, top+HEADER_H, panelW-12, ACTIVITY_H+6`（高 24），
        //   而这一行实际占的是 HEADER_H ~ HEADER_H+ACTIVITY_H（高 18）**加上**
        //   下方列表标题那一点余量 —— 玩家从下方往上扫的时候会从缝里漏掉（差一两像素就什么都没有）。
        //   ⇒ 命中框改成 `top+HEADER_H-2` 起、高 `ACTIVITY_H+8`：
        //     **宽出一圈**（宁可多给一点，也不要让玩家觉得"这里没提示"）。
        if (inRect(mouseX, mouseY, left + 3, top + HEADER_H - 2, panelW - 6, ACTIVITY_H + 8)) {
            List<Component> tip = new ArrayList<>();
            tip.add(Component.translatable("gui.anglertackle.quest_tip_activity")
                    .withStyle(net.minecraft.ChatFormatting.YELLOW));
            QuestPayload snap = snap();
            int activity = snap == null ? 0 : snap.activity();
            for (int bit = 0; bit < QuestTiers.count(); bit++) {
                boolean got = snap != null && (snap.claimedTiers() & (1 << bit)) != 0;
                int lack = Math.max(0, QuestTiers.AT[bit] - activity);
                String key = got ? "gui.anglertackle.quest_tip_tier_claimed"
                        : (lack > 0 ? "gui.anglertackle.quest_tip_tier_locked"
                        : "gui.anglertackle.quest_tip_tier_pending");
                tip.add(Component.translatable(key, QuestTiers.AT[bit], tierRewardText(bit), lack)
                        .withStyle(got ? net.minecraft.ChatFormatting.GREEN
                                : (lack > 0 ? net.minecraft.ChatFormatting.GRAY
                                : net.minecraft.ChatFormatting.YELLOW)));
            }
            tip.add(Component.translatable("gui.anglertackle.quest_tip_activity_hint")
                    .withStyle(net.minecraft.ChatFormatting.DARK_GRAY));
            g.renderComponentTooltip(this.font, tip, mouseX, mouseY);
            return;
        }
        // ② 列表行：奖励 / 状态 / 期限（命中框与 mouseClicked 逐字一致）
        List<Row> list = rows();
        for (int i = 0; i < list.size(); i++) {
            int y = rowYOf(i);
            if (!inRect(mouseX, mouseY, listX(), y, LIST_W, LIST_ROW_H - 2)) {
                continue;
            }
            Row r = list.get(i);
            List<Component> tip = new ArrayList<>();
            tip.add(Component.literal(r.name).withStyle(net.minecraft.ChatFormatting.YELLOW));
            tip.add(Component.translatable("gui.anglertackle.quest_tip_reward", rewardText(r.def))
                    .withStyle(net.minecraft.ChatFormatting.GOLD));
            tip.add(Component.translatable("gui.anglertackle.quest_tip_state", statusText(r))
                    .withStyle(r.claimed ? net.minecraft.ChatFormatting.GREEN : net.minecraft.ChatFormatting.GRAY));
            tip.add(Component.translatable("gui.anglertackle.quest_tip_deadline",
                    tr(r.daily ? "gui.anglertackle.quest_deadline_daily"
                            : "gui.anglertackle.quest_deadline_weekly"))
                    .withStyle(net.minecraft.ChatFormatting.GRAY));
            g.renderComponentTooltip(this.font, tip, mouseX, mouseY);
            return;
        }
        // ③ 详情栏奖励行（dy 与 rebuild() 里那一行逐字一致）：物品弹原版说明，鱼币讲发奖方式
        Row sel = selected();
        if (sel != null) {
            int dx = detailX();
            int ry = listTop() + 3 + 14 + 16;
            if (inRect(mouseX, mouseY, dx + 4, ry - 2, detailW() - 8, 14)) {
                if (sel.def.givesItem()) {
                    ItemStack st = stackOf(sel.def.itemId(), sel.def.itemCount());
                    if (st != null) {
                        g.renderTooltip(this.font, st, mouseX, mouseY);
                        return;
                    }
                }
                g.renderComponentTooltip(this.font, List.of(
                        Component.translatable("gui.anglertackle.quest_tip_reward_mail")
                                .withStyle(net.minecraft.ChatFormatting.GRAY)), mouseX, mouseY);
            }
        }
    }

    // ------------------------------------------------------------------ 渲染
    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(g, mouseX, mouseY, partialTick);
        // 面板 + 边框（外深内亮，与既有五个界面一致）
        g.fill(left - 1, top - 1, left + panelW + 1, top + panelH + 1, C_SHADOW);
        g.fill(left, top, left + panelW, top + panelH, C_PANEL);
        g.fill(left, top, left + panelW, top + 1, C_LINE);
        g.fill(left, top + panelH - 1, left + panelW, top + panelH, C_LINE);
        g.fill(left, top, left + 1, top + panelH, C_LINE);
        g.fill(left + panelW - 1, top, left + panelW, top + panelH, C_LINE);

        int listX = listX();
        int listTop = listTop();
        int bottom = top + panelH - FOOTER_H;
        // 两块面板的底
        g.fill(listX - 1, listTop - 1, listX + LIST_W + 1, bottom, C_TRACK);
        g.fill(detailX() - 1, listTop - 1, detailX() + detailW() + 1, bottom, C_TRACK);

        QuestPayload snap = snap();
        // 活跃度条：底 + 填充（宽度按 activity / cap 现算）
        if (snap != null && snap.cap() > 0) {
            int bx = left + 6;
            int bw = panelW - 12;
            int by = top + HEADER_H + 13;
            g.fill(bx, by, bx + bw, by + BAR_THICK, C_TRACK);
            int filled = (int) Math.round(bw * Math.min(1.0, snap.activity() / (double) snap.cap()));
            if (filled > 0) {
                g.fill(bx, by, bx + filled, by + BAR_THICK, C_LABEL);
            }
        }

        // 列表行的底：选中高亮 + 左侧色带（每日 = 蓝、周常 = 金）
        List<Row> list = rows();
        if (snap != null && !list.isEmpty()) {
            int y = listTop;
            boolean dailyHeaderDrawn = false;
            boolean weeklyHeaderDrawn = false;
            for (Row r : list) {
                if (r.daily && !dailyHeaderDrawn) {
                    y += GROUP_H;
                    dailyHeaderDrawn = true;
                }
                if (!r.daily && !weeklyHeaderDrawn) {
                    y += GROUP_H;
                    weeklyHeaderDrawn = true;
                }
                if (r.id.equals(selectedId)) {
                    g.fill(listX, y, listX + LIST_W, y + LIST_ROW_H - 2, C_SEL);
                }
                g.fill(listX, y, listX + BAR_W, y + LIST_ROW_H - 2, r.daily ? C_LABEL : C_TITLE);
                y += LIST_ROW_H;
            }
        }

        // 详情栏的分隔线 + 进度条（文字是 widget，线和条得自己画）
        Row sel = selected();
        if (snap != null && sel != null) {
            int dx = detailX();
            int dw = detailW();
            g.fill(dx + 4, listTop + 16, dx + dw - 4, listTop + 17, C_LINE);
            int px = dx + 4;
            int pw = dw - 8;
            int py = listTop() + 3 + 14 + 16;
            g.fill(px, py, px + pw, py + BAR_THICK, C_TRACK);
            QuestData.Row row = new QuestData.Row(sel.progress, sel.claimed);
            double need = Math.max(1.0, QuestGoal.displayTarget(sel.def));
            double now = QuestGoal.display(sel.def, row);
            int filled = (int) Math.round(pw * Math.min(1.0, now / need));
            if (filled > 0) {
                g.fill(px, py, px + filled, py + BAR_THICK, sel.claimed ? C_TITLE : C_LABEL);
            }
        }

        // ⚠ **不要调 super.render(...)**：它内部会再调一次 renderBackground ⇒ 那层全屏暗化
        //   盖在面板与文字上，表现是"界面朦胧、白字发灰"（守着这条的是 tools/check-screen-render.js）。
        for (net.minecraft.client.gui.components.Renderable r : this.renderables) {
            r.render(g, mouseX, mouseY, partialTick);
        }
        // 悬浮提示放在**最后**画（盖在所有东西上面）—— 照 MailScreen 的范式
        renderHoverTips(g, mouseX, mouseY);
    }

    // ------------------------------------------------------------------ 输入
    /** 点列表行 = 选中（这个界面**没有任何写操作**：接取在邮件里，领取在邮箱里）。 */
    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        int listX = listX();
        List<Row> list = rows();
        int y = listTop();
        boolean dailyHeaderDrawn = false;
        boolean weeklyHeaderDrawn = false;
        for (Row r : list) {
            if (r.daily && !dailyHeaderDrawn) {
                y += GROUP_H;
                dailyHeaderDrawn = true;
            }
            if (!r.daily && !weeklyHeaderDrawn) {
                y += GROUP_H;
                weeklyHeaderDrawn = true;
            }
            if (mx >= listX && mx <= listX + LIST_W && my >= y && my <= y + LIST_ROW_H - 2) {
                selectedId = r.id;
                rebuild();
                return true;
            }
            y += LIST_ROW_H;
        }
        return super.mouseClicked(mx, my, button);
    }
}
