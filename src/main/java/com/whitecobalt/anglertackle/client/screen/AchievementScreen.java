package com.whitecobalt.anglertackle.client.screen;

import com.whitecobalt.anglertackle.client.ClientAchievements;
import com.whitecobalt.anglertackle.network.AchievementPayload;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * **成就面板**（策划 `docs/41` §7 A4；用户 2026-10-15："找不到成就面板"）。
 *
 * <h2>三栏几何（**只用下面这组常量**，别再各写各的）</h2>
 * <pre>
 *   面板 470×224（走 {@link UiLayout} 折算）
 *   ├ 左栏 分类：LEFT_X(8) … +LEFT_W(108)   ← 组名 + 右对齐的 x/y
 *   ├ 间隔 MID_GAP(18)                      ← **这段是故意的**：中栏的选中高亮从 MID_X-12 起，
 *   │                                          左栏右缘必须 ≤ MID_X-14，否则高亮会压住 x/y
 *   ├ 中栏 列表：MID_X(134) … +MID_W(164)     ← ✔/✘ + 名字
 *   └ 右栏 详情：RIGHT_X(308) … 面板右缘-8    ← 条件 / 奖励 / 状态
 * </pre>
 *
 * <h2>设计语言（2026-10-15 用户："可以参考市面上其他游戏，至少设计语言可以看一下，比如原神"）</h2>
 * 抄的是**信息结构**，不是美术：
 * <ul>
 *   <li><b>左侧分类 + 每类小进度</b>（原神按"天地万象 / 心跳的记忆"分组）—— 这里按 id 前缀分
 *       `a_*`（图鉴与纪录）/ `b_*`（品质初见），组名走语言键；</li>
 *   <li><b>顶部总进度</b>（达成数 + 百分比 + 进度条）—— 一眼看出"还差多少"；</li>
 *   <li><b>逐条奖励可见</b>（原神是原石 ×5/×10/×20）—— 这里显示 `鱼币 · 经验`；</li>
 *   <li><b>完成态强化</b>（金色 + ✔）＋ <b>未完成灰化</b>，未完成时把**达成条件**写在详情栏；</li>
 *   <li><b>筛选</b>（全部 / 未完成 / 已完成）—— 对应原神那个页签，键位 F；</li>
 *   <li>❌ <b>故意不抄"手动领取"按钮</b>：原神的奖励要玩家点【领取】，而本仓库的成就奖励
 *       走**邮件自动寄出**（`docs/36`）。再加一个领取入口就是**第二个奖励通道** ——
 *       `docs/41` §1 三条"不新造"里明令禁止。所以这里只写"已达成（奖励已寄到邮箱）"，
 *       真正的领取在玩家熟悉的邮箱界面 ✓。</li>
 * </ul>
 *
 * <h2>渲染顺序（2026-10-15 糊过一次，别再改）</h2>
 * 背景由 {@code extractBackground} 在 {@code extractRenderState} 之前抽取，本类只画内容；
 * **绝不调** {@code super.extractRenderState()}（本界面没有 widget，也不必重画背景）。
 */
public class AchievementScreen extends Screen {

    private static final int DESIGN_W = 470;
    private static final int DESIGN_H = 224;
    private static final int ROW_H = 12;

    // ── 三栏几何：**唯一真源**（render 与 mouseClicked 都用它们，别再重复写字面量） ──
    private static final int LEFT_X = 8;
    private static final int LEFT_W = 108;
    private static final int MID_GAP = 18;
    private static final int MID_X = LEFT_X + LEFT_W + MID_GAP;
    private static final int MID_W = 164;
    private static final int RIGHT_X = MID_X + MID_W + 10;
    private static final int SEL_PAD = 12;          // 中栏选中高亮向左多出的量（必须 < MID_GAP）

    private static final int COLOR_BG = 0xF0101010;
    private static final int COLOR_FRAME = 0xFF3A3A3A;
    private static final int COLOR_TITLE = 0xFFE8C56A;
    private static final int COLOR_GOT = 0xFF7FE07F;
    private static final int COLOR_LOCKED = 0xFF808080;
    private static final int COLOR_REWARD = 0xFF9AB6D8;
    private static final int COLOR_EMPTY = 0xFFB0B0B0;
    private static final int COLOR_SELECT = 0x40FFFFFF;
    private static final int COLOR_BAR_BG = 0xFF2A2A2A;

    /** 筛选档：0 全部、1 未完成、2 已完成。 */
    private static final int FILTER_ALL = 0;
    private static final int FILTER_LOCKED = 1;
    private static final int FILTER_UNLOCKED = 2;

    /** 一条成就（客户端只为画界面而拼的只读视图）。 */
    private record Entry(String id, boolean unlocked, long coins, int xp, String group) {
    }

    private final List<Entry> all = new ArrayList<>();
    private final List<String> groups = new ArrayList<>();
    private int panelX;
    private int panelY;
    private int panelW;
    private int panelH;
    private int got;
    private int total;
    private int filter = FILTER_ALL;
    private int groupIndex;
    private int rowIndex;
    private int scroll;

    public AchievementScreen() {
        super(Component.translatable("gui.anglertackle.ach.title"));
    }

    /** 已经开着窗口时收到新快照 ⇒ 就地刷新（不要闪一下），由包处理器调用。 */
    public void refresh() {
        rebuild();
    }

    @Override
    protected void init() {
        this.panelW = UiLayout.panelW(this.width, DESIGN_W, 240);
        this.panelH = UiLayout.panelH(this.height, DESIGN_H, 120);
        this.panelX = (this.width - this.panelW) / 2;
        this.panelY = (this.height - this.panelH) / 2;
        rebuild();
    }

    private void rebuild() {
        all.clear();
        groups.clear();
        got = 0;
        AchievementPayload p = ClientAchievements.latest();
        if (p == null) {
            total = 0;
            return;
        }
        total = p.total();
        for (String row : p.rows()) {
            String[] f = row.split(AchievementPayload.FIELD_SEP, -1);
            if (f.length < 5) {
                continue;                       // 字段不齐 ⇒ 跳过这一行，不要整块崩掉
            }
            boolean has = "1".equals(f[1]);
            // 分组按 id 前缀（docs/41 §4 的类别）：a_ 图鉴与纪录 / b_ 品质初见 / c_ 等级成长。
            // 加新类别时**这里 + 语言键 `gui.anglertackle.ach.group.<组名>`** 一起补，
            // 少一个就会在界面上显示成一串键名（check-lang 会拦）。
            // 分组按**策划案 §4 的类别前缀**（不是我自己发明的分组）：
            //   a_ 图鉴与纪录 / b_ 品质初见 / c_ 尺寸纪录 / d_ 等级成长 / e_ 技法操作
            String group = switch (f[0].charAt(0)) {
                case 'b' -> "quality";
                case 'c' -> "size";
                case 'd' -> "level";
                case 'e' -> "skill";
                case 'f' -> "league";
                case 'g' -> "cook";
                case 'h' -> "aquarium";
                case 'i' -> "environment";
                case 'j' -> "economy";
                case 'k' -> "quest";
                default -> "codex";
            };
            all.add(new Entry(f[0], has, parseLong(f[3]), parseInt(f[4]), group));
            if (has) {
                got++;
            }
            if (!groups.contains(group)) {
                groups.add(group);
            }
        }
        if (rowIndex >= visible().size()) {
            rowIndex = Math.max(0, visible().size() - 1);
        }
    }

    private static int parseInt(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (RuntimeException e) {
            return 0L;
        }
    }

    /** 当前分类 + 筛选下可见的条目。 */
    private List<Entry> visible() {
        List<Entry> out = new ArrayList<>();
        if (groups.isEmpty()) {
            return out;
        }
        String group = groups.get(Math.min(groupIndex, groups.size() - 1));
        for (Entry e : all) {
            if (!e.group().equals(group)) {
                continue;
            }
            if (filter == FILTER_LOCKED && e.unlocked()) {
                continue;
            }
            if (filter == FILTER_UNLOCKED && !e.unlocked()) {
                continue;
            }
            out.add(e);
        }
        return out;
    }

    private int groupGot(String group) {
        int n = 0;
        for (Entry e : all) {
            if (e.group().equals(group) && e.unlocked()) {
                n++;
            }
        }
        return n;
    }

    private int groupTotal(String group) {
        int n = 0;
        for (Entry e : all) {
            if (e.group().equals(group)) {
                n++;
            }
        }
        return n;
    }

    private static String groupName(String group) {
        return Component.translatable("gui.anglertackle.ach.group." + group).getString();
    }

    private static String nameOf(String id) {
        // ⚠ 前缀与 AchievementService.NAME_PREFIX 一致（那边是服务端类，客户端不加载它）。
        return Component.translatable("achievement.anglertackle." + id).getString();
    }

    private static String descOf(String id) {
        return Component.translatable("achievement.anglertackle." + id + ".desc").getString();
    }

    private String filterName() {
        String k = filter == FILTER_LOCKED ? "locked" : filter == FILTER_UNLOCKED ? "unlocked" : "all";
        return Component.translatable("gui.anglertackle.ach.filter." + k).getString();
    }

    private int bodyTop() {
        return panelY + 26;
    }

    private int bodyBottom() {
        return panelY + panelH - 16;
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        // 背景由 extractBackground 在本方法之前抽取（Screen.extractRenderStateWithTooltipAndSubtitles）；
        // 这里只画内容，不再调 renderBackground，也不调 super（本界面没有 widget）。
        g.fill(panelX, panelY, panelX + panelW, panelY + panelH, COLOR_BG);
        g.fill(panelX, panelY, panelX + panelW, panelY + 1, COLOR_FRAME);
        g.fill(panelX, panelY + panelH - 1, panelX + panelW, panelY + panelH, COLOR_FRAME);
        g.fill(panelX, panelY, panelX + 1, panelY + panelH, COLOR_FRAME);
        g.fill(panelX + panelW - 1, panelY, panelX + panelW, panelY + panelH, COLOR_FRAME);

        // ── 顶部：标题 + 总进度 + 进度条 ──
        g.text(this.font, this.title, panelX + LEFT_X, panelY + 6, COLOR_TITLE, false);
        int pct = total <= 0 ? 0 : (int) Math.round(got * 100.0 / total);
        String right = got + " / " + total + "   " + pct + "%";
        g.text(this.font, right, panelX + panelW - 8 - this.font.width(right), panelY + 6, COLOR_GOT, false);
        int barX = panelX + LEFT_X;
        int barW = panelW - LEFT_X * 2;
        g.fill(barX, panelY + 17, barX + barW, panelY + 20, COLOR_BAR_BG);
        if (total > 0) {
            g.fill(barX, panelY + 17, barX + Math.max(1, barW * got / total), panelY + 20, COLOR_GOT);
        }

        final int leftX = panelX + LEFT_X;
        final int midX = panelX + MID_X;
        final int rightX = panelX + RIGHT_X;
        final int rightW = panelX + panelW - 8 - rightX;
        final int top = bodyTop();
        final int bottom = bodyBottom();

        if (all.isEmpty()) {
            String msg = ClientAchievements.synced()
                    ? Component.translatable("gui.anglertackle.ach.empty").getString()
                    : Component.translatable("gui.anglertackle.ach.reading").getString();
            g.text(this.font, msg, leftX, top, COLOR_EMPTY, false);
            return;
        }

        // ── 左栏：分类 + 每类小进度（x/y 右对齐在 **左栏内**，不许越到中栏去） ──
        for (int i = 0; i < groups.size(); i++) {
            int y = top + i * (ROW_H + 2);
            boolean sel = i == groupIndex;
            if (sel) {
                g.fill(leftX - 3, y - 1, leftX + LEFT_W + 2, y + ROW_H - 1, COLOR_SELECT);
            }
            String cnt = groupGot(groups.get(i)) + "/" + groupTotal(groups.get(i));
            int cntW = this.font.width(cnt);
            // 组名给计数留出位置（cntW + 4 的间隔），左右都不越界
            g.text(this.font, UiLayout.fitText(groupName(groups.get(i)), LEFT_W - cntW - 6), leftX, y,
                    sel ? COLOR_TITLE : COLOR_LOCKED, false);
            g.text(this.font, cnt, leftX + LEFT_W - cntW, y, COLOR_LOCKED, false);
        }

        // ── 中栏：条目列表（已完成金色 + ✔，未完成灰色） ──
        List<Entry> list = visible();
        int rows = Math.max(1, (bottom - top) / ROW_H);
        int maxScroll = Math.max(0, list.size() - rows);
        if (scroll > maxScroll) {
            scroll = maxScroll;
        }
        if (list.isEmpty()) {
            g.text(this.font, Component.translatable("gui.anglertackle.ach.empty").getString(),
                    midX, top, COLOR_EMPTY, false);
        }
        g.enableScissor(midX - SEL_PAD, top, midX + MID_W, bottom);
        for (int i = 0; i < rows && scroll + i < list.size(); i++) {
            int idx = scroll + i;
            Entry e = list.get(idx);
            int y = top + i * ROW_H;
            if (idx == rowIndex) {
                g.fill(midX - SEL_PAD, y - 1, midX + MID_W, y + ROW_H - 1, COLOR_SELECT);
            }
            g.text(this.font, e.unlocked() ? "✔" : "✘", midX - 11, y,
                    e.unlocked() ? COLOR_GOT : COLOR_LOCKED, false);
            g.text(this.font, UiLayout.fitText(nameOf(e.id()), MID_W - 6), midX, y,
                    e.unlocked() ? COLOR_GOT : COLOR_LOCKED, false);
        }
        g.disableScissor();
        if (maxScroll > 0) {
            int trackH = bottom - top;
            int barH = Math.max(12, trackH * rows / list.size());
            int barY = top + (trackH - barH) * scroll / maxScroll;
            g.fill(midX + MID_W + 2, barY, midX + MID_W + 4, barY + barH, COLOR_FRAME);
        }

        // ── 右栏：选中条目的详情（条件 + 奖励 + 状态） ──
        if (!list.isEmpty()) {
            Entry sel = list.get(Math.min(rowIndex, list.size() - 1));
            int y = top;
            g.text(this.font, UiLayout.fitText(nameOf(sel.id()), rightW), rightX, y,
                    sel.unlocked() ? COLOR_GOT : COLOR_LOCKED, false);
            y += ROW_H + 2;
            g.text(this.font, Component.translatable("gui.anglertackle.ach.detail.condition").getString(),
                    rightX, y, COLOR_TITLE, false);
            y += ROW_H;
            for (String line : UiLayout.wrapCjk(descOf(sel.id()), rightW)) {
                if (y > bottom - ROW_H * 4) {
                    break;
                }
                g.text(this.font, line, rightX, y, COLOR_EMPTY, false);
                y += ROW_H;
            }
            y += 2;
            g.text(this.font, Component.translatable("gui.anglertackle.ach.detail.reward").getString(),
                    rightX, y, COLOR_TITLE, false);
            y += ROW_H;
            g.text(this.font, Component.translatable("gui.anglertackle.ach.reward",
                    String.valueOf(sel.coins()), String.valueOf(sel.xp())).getString(),
                    rightX, y, COLOR_REWARD, false);
            // ⚠ 连带改动（用户 2026-10-15 进游戏验收指出）：这条成就**顺带授予的称号**必须在这里说出来 ——
            //   否则玩家只看到币，不知道称号是哪来的（邮件里也已经写明了，两处一致）✓。
            //   第 6 段就是称号 id（没有则空串）；就地扫当前快照那一行，不额外加结构。
            AchievementPayload snap = ClientAchievements.latest();
            if (snap != null) {
                for (String row : snap.rows()) {
                    String[] parts = row.split(AchievementPayload.FIELD_SEP, -1);
                    if (parts.length >= 6 && !parts[5].isEmpty() && parts[0].equals(sel.id())) {
                        y += ROW_H;
                        g.text(this.font, UiLayout.fitText(Component.translatable(
                                        "gui.anglertackle.ach.with_title",
                                        Component.translatable("title.anglertackle." + parts[5]).getString()).getString(),
                                rightW), rightX, y, COLOR_TITLE, false);
                        break;
                    }
                }
            }
            y += ROW_H + 2;
            g.text(this.font, Component.translatable("gui.anglertackle.ach.detail.state").getString(),
                    rightX, y, COLOR_TITLE, false);
            y += ROW_H;
            g.text(this.font, UiLayout.fitText(Component.translatable(sel.unlocked()
                    ? "gui.anglertackle.ach.state.done" : "gui.anglertackle.ach.state.todo").getString(), rightW),
                    rightX, y, sel.unlocked() ? COLOR_GOT : COLOR_LOCKED, false);
        }

        // ── 底部：筛选状态 + 提示 ──
        String hint = "[" + filterName() + "]  "
                + Component.translatable("gui.anglertackle.ach.hint").getString();
        g.text(this.font, UiLayout.fitText(hint, panelW - LEFT_X * 2), panelX + LEFT_X, panelY + panelH - 12,
                COLOR_LOCKED, false);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        scroll = Math.max(0, scroll - (int) Math.signum(scrollY));
        return true;
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        double mouseX = event.x();
        double mouseY = event.y();
        int button = event.button();
        int leftX = panelX + LEFT_X;
        int midX = panelX + MID_X;
        int top = bodyTop();
        int bottom = bodyBottom();
        if (mouseX >= leftX - 3 && mouseX < leftX + LEFT_W + 2 && mouseY >= top && mouseY < bottom) {
            int idx = (int) ((mouseY - top) / (ROW_H + 2));
            if (idx >= 0 && idx < groups.size()) {
                groupIndex = idx;
                rowIndex = 0;
                scroll = 0;
                return true;
            }
        }
        if (mouseX >= midX - SEL_PAD && mouseX < midX + MID_W && mouseY >= top && mouseY < bottom) {
            int idx = scroll + (int) ((mouseY - top) / ROW_H);
            if (idx >= 0 && idx < visible().size()) {
                rowIndex = idx;
                return true;
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        int keyCode = event.key();
        // 70 = F：循环 全部 → 未完成 → 已完成（对应原神那个页签的位置）
        if (keyCode == 70) {
            filter = (filter + 1) % 3;
            rowIndex = 0;
            scroll = 0;
            return true;
        }
        int size = visible().size();
        if (keyCode == 265 && rowIndex > 0) {                    // ↑
            rowIndex--;
            return true;
        }
        if (keyCode == 264 && rowIndex < size - 1) {             // ↓
            rowIndex++;
            return true;
        }
        if (keyCode == 263 && groupIndex > 0) {                  // ←
            groupIndex--;
            rowIndex = 0;
            scroll = 0;
            return true;
        }
        if (keyCode == 262 && groupIndex < groups.size() - 1) {  // →
            groupIndex++;
            rowIndex = 0;
            scroll = 0;
            return true;
        }
        return super.keyPressed(event);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
