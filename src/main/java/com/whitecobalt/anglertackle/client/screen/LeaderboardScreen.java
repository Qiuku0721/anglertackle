package com.whitecobalt.anglertackle.client.screen;

import java.util.ArrayList;
import java.util.List;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.item.Quality;
import com.whitecobalt.anglertackle.network.RankPayload;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import org.lwjgl.glfw.GLFW;

/**
 * 排行榜界面（2026-10-10 M1 ✓）。
 *
 * <h2>交互（用户要求"像老柯那边一样能看见板块、能跳转" ✓）</h2>
 * <ul>
 *   <li><b>左侧</b>是榜单目录 ✓（十来个维度 ✓），**当前榜高亮** ✓、悬停变亮 ✓</li>
 *   <li>**鼠标点击**任意一行切换 ✓；**← →** 也能切 ✓</li>
 *   <li>切换是**纯本地**的 ✓ —— 数据打开时**一次全发过来** ✓ ⇒ 零延迟、无往返 ✓</li>
 * </ul>
 *
 * <h2>一行的四个要素（用户 2026-10-10 逐条点名 ✓）</h2>
 * <ol>
 *   <li>**颜色** ✓：鱼名/品质/评级按**品质档**上色 ✓ —— 走 {@code Quality.argb()} ✓
 *       （与 tooltip / 图鉴**同一套**色号 ✓，绝不手抄 ✗）</li>
 *   <li>**体长** ✓：服务端给（{@code FishData.lengthCm()} 口径 ✓）</li>
 *   <li>**中文名** ✓：**客户端**从物品注册表取这条鱼的本地化名 ✓
 *       （服务端没有语言表 ✗，那边只能给 id ✓）</li>
 *   <li>**品质** ✓：白/绿/蓝/紫/金/红 ✓（顺序与 {@code Quality} 枚举一致 ✓）</li>
 * </ol>
 *
 * <p>服务端只发**字段**（{@code \u0003} 分隔 ✓），好看的部分全在这里 ✓ ⇒ 不存在两套口径走散 ✗。
 */
public class LeaderboardScreen extends Screen {

    private static final int PANEL_W = 470, PANEL_H = 224;
    private static final int MIN_W = 300;
    private static final int TOC_TOP = 34, BODY_TOP = 30, FOOTER_H = 26, LINE_STEP = 11;
    private static final int TOC_W = 118, PAD = 10;

    /** 目录标签行（在标题下面一行）。 */
    private static final int TAB_TOP = 20, TAB_H = 11;

    /**
     * 目录（用户 2026-10-13 定案："全要，分目录"）。
     *
     * <p>分组依据是**板块 id 的前缀**（服务端约定，见 `RankSnapshot` 各处的 id）——
     * 这样**不用改网络包**（`RankPayload.Board` 一个字段都没加）就能把 ~47 个板块分成 5 个目录，
     * 也就不会因为"多一级目录"去动那条已经稳了的协议。
     *
     * <p>⚠ **顺序即显示顺序，"联赛"必须排第一**：默认视图＝第一个非空目录的第一项。
     */
    private static final String[] GROUP_NAMES = {
            "联赛", "总联赛·大型", "总联赛·中型", "总联赛·小型", "总榜",
    };

    /** 六档品质的中文名 ✓（顺序与 {@code Quality} 的枚举一致：白→绿→蓝→紫→金→红 ✓）。 */
    private static final String[] QUALITY_CN = {"白", "绿", "蓝", "紫", "金", "红"};

    private final List<RankPayload.Board> boards;
    /** 每个目录下的板块下标（`groups.get(g)` 是目录 g 的条目列表）。 */
    private final List<List<Integer>> groups = new ArrayList<>();
    /** 当前目录。 */
    private int group;
    /** 当前目录里的第几项。 */
    private int sub;

    private int panelW, panelH, left, top, tocX, rowsPerPage, bodyX, bodyW;

    public LeaderboardScreen(RankPayload payload) {
        super(Component.literal("排行榜"));
        List<RankPayload.Board> b = payload == null ? List.of() : payload.boards();
        this.boards = b;
        String prefer = payload == null ? "" : payload.prefer();
        for (int g = 0; g < GROUP_NAMES.length; g++) {
            this.groups.add(new ArrayList<>());
        }
        for (int i = 0; i < b.size(); i++) {
            this.groups.get(groupOf(b.get(i).id())).add(i);
        }
        // 默认 = **第一个非空目录的第一项**：联赛板块排在最前 ⇒ 打开就是"最近联赛"
        //   （没有联赛数据时第 0 个目录是空的，会自动落到"总榜"，与以前完全一样 ✓）
        this.group = 0;
        while (this.group < this.groups.size() && this.groups.get(this.group).isEmpty()) {
            this.group++;
        }
        if (this.group >= this.groups.size()) {
            this.group = 0;
        }
        this.sub = 0;
        for (int i = 0; i < b.size(); i++) {
            if (b.get(i).id().equalsIgnoreCase(prefer)) {
                this.group = groupOf(b.get(i).id());
                this.sub = Math.max(0, this.groups.get(this.group).indexOf(i));
                break;
            }
        }
    }

    /**
     * 板块 id → 目录下标。
     *
     * <p>前缀全是**服务端约定**的（`RankSnapshot` 里各板块的 id）：{@code league} / {@code league_sN}
     * = 联赛与历届；{@code ltl_/ltm_/lts_} = 大/中/小型联赛的各个维度；其余（原有 10 个维度
     * + 比赛"本场"）= 总榜。
     */
    private static int groupOf(String id) {
        String s = id == null ? "" : id;
        if (s.equals("league") || s.startsWith("league_")) {
            return 0;
        }
        if (s.startsWith("ltl_")) {
            return 1;
        }
        if (s.startsWith("ltm_")) {
            return 2;
        }
        if (s.startsWith("lts_")) {
            return 3;
        }
        return 4;
    }

    /** S→C 包入口 ✓（在 ClientPayloadHandlers 的注册里引用 ✓）。 */
    public static void handle(RankPayload payload, IPayloadContext context) {
        Minecraft.getInstance().setScreen(new LeaderboardScreen(payload));
    }

    @Override
    protected void init() {
        this.panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
        this.panelH = UiLayout.panelH(this.height, PANEL_H, BODY_TOP + FOOTER_H + LINE_STEP);
        this.tocX = UiLayout.fitX(PAD, PANEL_W, this.panelW, 4);
        this.bodyX = this.tocX + TOC_W + 6;
        this.bodyW = Math.max(50, this.panelW - this.bodyX - PAD);
        this.rowsPerPage = UiLayout.rows(this.panelH, BODY_TOP, FOOTER_H, LINE_STEP);
        this.left = (this.width - this.panelW) / 2;
        this.top = (this.height - this.panelH) / 2;
    }

    private RankPayload.Board current() {
        List<Integer> g = this.groups.get(this.group);
        return g.isEmpty() ? null : this.boards.get(g.get(Math.min(this.sub, g.size() - 1)));
    }

    /** ← → ：**在当前目录内**换条目（换目录用鼠标点上面的标签）。 */
    private void switchBy(int delta) {
        List<Integer> g = this.groups.get(this.group);
        if (!g.isEmpty()) {
            this.sub = Math.floorMod(this.sub + delta, g.size());
        }
    }

    /** 目录标签的宽度（渲染与点击**共用这一处** —— 两处各算一遍迟早点不准）。 */
    private int tabWidth(int g) {
        return this.font.width(GROUP_NAMES[g]) + 10;
    }

    /** 这个目录有没有条目（**空的目录不画标签**：点开是空的比没有更糟）。 */
    private boolean tabVisible(int g) {
        return !this.groups.get(g).isEmpty();
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        double mouseX = event.x();
        double mouseY = event.y();
        int button = event.button();
        if (button == 0) {
            // ① 目录标签（空目录不画、也点不到）
            int tx = this.left + PAD;
            for (int g = 0; g < GROUP_NAMES.length; g++) {
                if (!tabVisible(g)) {
                    continue;
                }
                int w = tabWidth(g);
                if (mouseX >= tx && mouseX <= tx + w
                        && mouseY >= this.top + TAB_TOP && mouseY <= this.top + TAB_TOP + TAB_H) {
                    this.group = g;
                    this.sub = 0;               // 换目录从头看起
                    return true;
                }
                tx += w + 4;
            }
            // ② 左侧：**当前目录**下的条目
            List<Integer> toc = this.groups.get(this.group);
            int y = this.top + TOC_TOP;
            for (int i = 0; i < toc.size(); i++) {
                if (mouseX >= this.left + this.tocX - 3 && mouseX <= this.left + this.tocX + TOC_W
                        && mouseY >= y - 1 && mouseY <= y + LINE_STEP - 1) {
                    this.sub = i;
                    return true;
                }
                y += LINE_STEP;
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        int keyCode = event.key();
        if (keyCode == GLFW.GLFW_KEY_LEFT || keyCode == GLFW.GLFW_KEY_PAGE_UP) {
            switchBy(-1);
            return true;
        }
        if (keyCode == GLFW.GLFW_KEY_RIGHT || keyCode == GLFW.GLFW_KEY_PAGE_DOWN) {
            switchBy(1);
            return true;
        }
        return super.keyPressed(event);
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor gfx, int mouseX, int mouseY, float partialTick) {
        super.extractRenderState(gfx, mouseX, mouseY, partialTick);
        gfx.fill(this.left - 2, this.top - 2, this.left + this.panelW + 2, this.top + this.panelH + 2, 0xC8000000);

        RankPayload.Board cur = current();
        gfx.text(this.font, UiLayout.fitText(cur == null ? "排行榜" : cur.name(), this.panelW - 2 * PAD),
                this.left + this.tocX, this.top + 10, 0xFFFFFF, false);

        // ---- 目录标签（点它换目录；**空目录不画** —— 点开是空的比没有更糟）----
        int tx = this.left + PAD;
        for (int g = 0; g < GROUP_NAMES.length; g++) {
            if (!tabVisible(g)) {
                continue;
            }
            int w = tabWidth(g);
            boolean selTab = g == this.group;
            boolean hoverTab = mouseX >= tx && mouseX <= tx + w
                    && mouseY >= this.top + TAB_TOP && mouseY <= this.top + TAB_TOP + TAB_H;
            if (selTab || hoverTab) {
                gfx.fill(tx - 2, this.top + TAB_TOP - 1, tx + w,
                        this.top + TAB_TOP + TAB_H, selTab ? 0x50FFFFFF : 0x28FFFFFF);
            }
            gfx.text(this.font, GROUP_NAMES[g], tx + 4, this.top + TAB_TOP,
                    selTab ? 0xFFF0C0 : 0x9AA0A6, false);
            tx += w + 4;
        }

        // ---- 左侧：**当前目录**下的条目 ----
        List<Integer> toc = this.groups.get(this.group);
        int y = this.top + TOC_TOP;
        for (int i = 0; i < toc.size() && y < this.top + this.panelH - FOOTER_H; i++) {
            RankPayload.Board b = this.boards.get(toc.get(i));
            boolean sel = i == this.sub;
            boolean hover = mouseX >= this.left + this.tocX - 3 && mouseX <= this.left + this.tocX + TOC_W
                    && mouseY >= y - 1 && mouseY <= y + LINE_STEP - 1;
            if (sel) {
                gfx.fill(this.left + this.tocX - 3, y - 1, this.left + this.tocX + TOC_W, y + LINE_STEP - 1, 0x60FFFFFF);
            }
            int color = sel ? 0xFFF0C0 : (hover ? 0xE0E0FF : 0xA0A4AA);
            gfx.text(this.font, UiLayout.fitText(b.name(), TOC_W), this.left + this.tocX, y, color, false);
            y += LINE_STEP;
        }

        if (cur != null) {
            int ly = this.top + BODY_TOP;
            for (int i = 0; i < cur.lines().size() && i < this.rowsPerPage; i++) {
                drawRow(gfx, cur.lines().get(i), ly);
                ly += LINE_STEP;
            }
            gfx.text(this.font, UiLayout.fitText(cur.footer(), this.bodyW),
                    this.left + this.bodyX, this.top + this.panelH - 22, 0x9AA0A6, false);
        }
        gfx.text(this.font, UiLayout.fitText("点上方目录分类 · 点左侧切榜 · ← → 或点击切换 · Esc 关闭", this.panelW - 2 * PAD),
                this.left + this.tocX, this.top + this.panelH - 10, 0x707070, false);
    }

    /**
     * 画一行 ✓（服务端发字段 ✓，这里负责**颜色 / 体长 / 中文名 / 品质** ✓）。
     *
     * <p>字段顺序（`\u0003` 分隔 ✓）：名次 / 玩家 / 数值 / 体长 / 鱼种 id / 评级 / 品质档 ✓。
     */
    private void drawRow(GuiGraphicsExtractor gfx, String line, int y) {
        String[] f = line.split("\u0003", -1);
        int tier = -1;
        if (f.length > 6) {
            try {
                tier = Integer.parseInt(f[6].trim());
            } catch (NumberFormatException ignored) {
                tier = -1;
            }
        }
        boolean known = tier >= 0 && tier < QUALITY_CN.length;
        int tierColor = known ? Quality.of(tier).argb() : 0xD8D8D8;

        StringBuilder head = new StringBuilder(f.length > 0 ? f[0] : "");
        if (f.length > 1) {
            head.append("  ").append(f[1]);
        }
        if (f.length > 2) {
            head.append("  ").append(f[2]);
        }
        if (f.length > 3 && !f[3].isEmpty()) {
            head.append("  ").append(f[3]);
        }
        String headText = UiLayout.fitText(head.toString(), this.bodyW);
        gfx.text(this.font, headText, this.left + this.bodyX, y, 0xD8D8D8, false);

        int x = this.left + this.bodyX + this.font.width(headText) + 6;
        int remain = this.left + this.bodyX + this.bodyW - x;
        if (remain <= 12) {
            return;
        }
        String fish = f.length > 4 ? fishLocalized(f[4]) : "";
        String quality = known ? QUALITY_CN[tier] : "";
        String grade = f.length > 5 ? f[5] : "";
        StringBuilder tail = new StringBuilder();
        if (!fish.isEmpty()) {
            tail.append(fish);
        }
        if (!quality.isEmpty()) {
            tail.append(tail.length() > 0 ? " · " : "").append(quality);
        }
        if (!grade.isEmpty()) {
            tail.append(tail.length() > 0 ? " · " : "").append(grade);
        }
        gfx.text(this.font, UiLayout.fitText(tail.toString(), remain), x, y, tierColor, false);
    }

    /** 鱼种 id → 中文名 ✓（客户端从物品注册表取本地化名 ✓；取不到退回 id ✓，绝不抛 ✗）。 */
    private static String fishLocalized(String id) {
        if (id == null || id.isEmpty()) {
            return "";
        }
        try {
            var item = BuiltInRegistries.ITEM.get(
                    Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, id))
                    .map(Holder.Reference::value).orElse(null);
            if (item != null && item != Items.AIR) {
                return new ItemStack(item).getHoverName().getString();
            }
        } catch (Throwable ignored) {
            // 退回 id ✓
        }
        return id;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
