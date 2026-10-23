package com.whitecobalt.anglertackle.client.screen;

import com.whitecobalt.anglertackle.client.ClientTitles;
import com.whitecobalt.anglertackle.item.Quality;
import com.whitecobalt.anglertackle.network.TitleActionPayload;
import com.whitecobalt.anglertackle.network.TitlePayload;
import com.whitecobalt.anglertackle.title.TitleDefs;
import com.whitecobalt.anglertackle.title.Titles;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.neoforged.neoforge.client.network.ClientPacketDistributor;

import java.util.ArrayList;
import java.util.List;

/**
 * 称号界面（用户 2026-10-12："**称号佩戴在哪，很难发现。**"）。
 *
 * <h2>为什么非要有这个界面</h2>
 * 在那之前，佩戴称号**只有** {@code /atl title use <id>} 一条路 ——
 * 也就是说：玩家得先知道有这条指令、再知道自己的 id 叫什么、还得打对。
 * 用户在游戏里直接的反应就是"很难发现" ✗。称号是**给别人看的**东西，
 * 拿到却不知道去哪戴，等于整套系统白做。所以：
 * <ul>
 *   <li>界面里**未获得的称号也列出来**（带获得条件）—— 那是"接下来去钓什么"的清单；</li>
 *   <li>**已获得的排在前面**，默认就能看见「佩戴 / 摘下」按钮；</li>
 *   <li>入口三个：{@code /atl title}、图鉴上的「称号」按钮、以及第一次拿到称号时
 *       聊天里那句提示（见 {@code message.anglertackle.title_got}）。</li>
 * </ul>
 *
 * <h2>版面（设计尺寸 470×224，与既有界面同一档）</h2>
 * <pre>
 * ┌─ 称号 ────────────────────────── 已获得 3/40 ─┐
 * │ ┌─ 列表 (200) ────┐ ┌─ 详情 (244) ─────────┐ │
 * │ │▌开竿        ▶   │ │ 开竿                  │ │
 * │ │ 白      佩戴中  │ │ 品质：白 · 已佩戴      │ │
 * │ │  垂纶学徒        │ │ ─────────────────── │ │
 * │ │ 白      已获得  │ │ 获得条件              │ │
 * │ │  …（每页 6 行）  │ │ 钓到第一条鱼           │ │
 * │ │ [&lt;] 1/7 [&gt;]     │ │ 在线拥有：1 人（阿明） │ │
 * │ └─────────────────┘ │           [ 佩戴 ]    │ │
 * │  [只看已获得]     Enter 佩戴/摘下 · F 筛选  [完成] │
 * └──────────────────────────────────────────────┘
 * </pre>
 *
 * <h2>纪律（与邮箱界面逐条对齐）</h2>
 * <ol>
 *   <li><b>划过只出提示</b>，绝不改任何状态；点行 = 只选中，**不自动佩戴**
 *       —— 佩戴是"给别人看的身份"，误触就换掉比误领一个附件更烦人；</li>
 *   <li><b>筛选后空了也要画字</b>（"只看已获得"点一下会看到一张空列表 ⇒
 *       空列表和"界面坏了"长得一模一样 ✗）；</li>
 *   <li>所有尺寸走 {@link UiLayout}（面板按窗口 clamp、行数现算、文字截断）；</li>
 *   <li>文字**一律走 {@link TextWidget}**（本机环境下 {@code drawString} 画出来是糊的，
 *       见 {@code docs/16} §"文字一律走 TextWidget"）—— 所以每一行字都在 {@link #rebuild()}
 *       里建成 widget，{@code render()} 只画底色、色带和分隔线；</li>
 *   <li>颜色：**界面底色复用既有常量**，而**称号名的颜色一律走 {@link Quality}**
 *       （档位从 {@link TitleDefs} 现读 —— 客户端和服务端读的就是同一张表，
 *       所以"图鉴里金字、称号界面里白字"这种分叉不可能出现 ✓）。</li>
 * </ol>
 */
public class TitleScreen extends Screen {

    // ---- 版面（设计尺寸）----
    private static final int PANEL_W = 470;
    private static final int PANEL_H = 224;
    private static final int MIN_W = 260;
    private static final int MIN_H = 160;
    private static final int LIST_W = 200;
    private static final int LIST_ROW_H = 24;
    private static final int HEADER_H = 18;
    private static final int FOOTER_H = 24;
    /** 列表栏底部留给翻页按钮的高度（行数公式里要扣掉，否则最后一行会压住 [&lt;] [&gt;]）。 */
    private static final int PAGER_H = 20;
    private static final int GAP = 10;
    /** 名字左边那条档位色带。 */
    private static final int BAR_W = 3;
    /** 详情栏底部那个按钮的尺寸。 */
    private static final int BTN_W = 74;
    private static final int BTN_H = 18;

    // ---- 颜色（**全部复用既有常量**：与 CodexScreen / MailScreen 顶部那几个逐字相同）----
    //   ⚠ 这里一个新色号都没起；称号名的颜色更不在这个表里 —— 它走 Quality.argb()。
    private static final int C_TITLE = 0xFFFFD050;
    private static final int C_LABEL = 0xFF8FCBF5;
    private static final int C_TEXT = 0xFFE8E8E8;
    private static final int C_DIM = 0xFFB0B0B0;
    private static final int C_HINT = 0xFF909090;
    private static final int C_PANEL = 0xFF243028;
    private static final int C_SHADOW = 0xF0000000;
    private static final int C_LINE = 0xFF5A6A60;
    private static final int C_TRACK = 0xFF3A4A40;
    /** 选中行的高亮（与邮箱界面同一个值）。 */
    private static final int C_SEL = 0x40FFFFFF;
    /** 失败提示 = 原版标准红（与邮箱界面的"已过期"同一个值，MC 全局都在用它）。 */
    private static final int C_ERR = 0xFFFF5555;

    private final List<Button> buttons = new ArrayList<>();
    private final List<TextWidget> texts = new ArrayList<>();

    private int panelW = PANEL_W;
    private int panelH = PANEL_H;
    private int left;
    private int top;
    private int rowsPerPage = 6;

    /** 选中的称号 id（空串 = 没选）。 */
    private String selectedId = "";
    private int page = 0;
    /**
     * 只看已获得。
     *
     * <p>**默认 false** —— 默认就该看得见"还有哪些没拿到、怎么拿"
     * （用户要的是"发现得了"；把没拿到的藏起来正好相反 ✗）。
     */
    private boolean onlyOwned = false;

    /**
     * 已手动展开的组（组键）。**默认空 ⇒ 全部收起** ——
     * 用户的要求是"不展开时界面观感跟现在一模一样"。
     *
     * <p>⚠ 只记"展开了哪些"，不记"收起了哪些"：新增的组自动处于收起态，
     * 不用在别处维护"新组默认值"。
     */
    private final java.util.Set<String> expandedGroups = new java.util.HashSet<>();
    /** 展开符号的方框边长（渲染 / 点击 / 悬浮提示**共用同一套几何**，避免三处各算一遍漂移）。 */
    private static final int MARKER = 11;
    /** 上一次动作的结果码（服务端回的），翻成一句话显示在按钮上方。 */
    private String lastError = "";

    public TitleScreen() {
        super(Component.translatable("gui.anglertackle.title_book"));
    }

    @Override
    protected void init() {
        // ★ 面板必须装得进窗口（同 CodexScreen / MailScreen：小窗口下 470 宽会出屏）
        panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
        panelH = UiLayout.panelH(this.height, PANEL_H, MIN_H);
        // 扣掉标题栏 + 翻页条：算多了就会把最后一行画到 [<] [>] 上面
        rowsPerPage = UiLayout.rows(panelH, HEADER_H + 4 + PAGER_H, FOOTER_H, LIST_ROW_H);
        this.left = (this.width - panelW) / 2;
        this.top = (this.height - panelH) / 2;
        rebuild();
    }

    private TitlePayload snap() {
        return ClientTitles.latest();
    }

    // ------------------------------------------------------------------ 数据行
    /** 一行称号的解析结果（**只读投影**，字段顺序与 `TitleSnapshot` 逐字对应）。 */
    private static final class Row {
        String id = "";
        boolean owned;
        int count;
        boolean equipped;
        int holders;
        List<String> names = List.of();
        int quality;
        boolean repeatable;
        String name = "";
        String cond = "";
        /**
         * 折叠组键：静态称号 = 它自己；实例 = 「模板 @ 规模」（**不含赛季号**）。
         * 同一组的各届折成一行（`docs/39` §5.4）。
         */
        String groupKey = "";
        /** 这一组的成员数（**>1 才画展开符号**）。 */
        int groupSize = 1;
        /** 是不是展开后露出来的"往年"子行（画缩进 + 变暗）。 */
        boolean child;
    }

    /** 解析快照（坏行直接跳过：界面宁可少一行，也不要崩）。 */
    private List<Row> parse() {
        TitlePayload snap = snap();
        List<Row> out = new ArrayList<>();
        if (snap == null) {
            return out;
        }
        for (String line : snap.rows()) {
            String[] f = line.split("\\|", -1);
            if (f.length < 6) {
                continue;
            }
            TitleDefs.Def def = TitleDefs.byId(f[0]);
            boolean instance = def == null && TitleDefs.validInstance(f[0]);
            if (def == null && !instance) {
                continue;   // 客户端既不认识这个静态 id、也认不出这个实例（版本不一致）⇒ 不画
            }
            Row r = new Row();
            r.id = f[0];
            r.owned = "1".equals(f[1]);
            try {
                r.count = Integer.parseInt(f[2]);
                r.equipped = "1".equals(f[3]);
                r.holders = Integer.parseInt(f[4]);
            } catch (NumberFormatException e) {
                continue;
            }
            r.names = f[5].isEmpty() ? List.of() : List.of(f[5].split("\u0001", -1));
            r.quality = TitleDefs.qualityOf(f[0]);
            // 实例**永远可重复**（每个赛季一条，`docs/39` §5）；静态看表
            r.repeatable = instance || def.repeatable();
            r.name = tr(Titles.nameKey(f[0]), Titles.nameArgs(f[0]));
            // ⚠ 必须**带上参数**：生成式称号的条件里也有占位符（例：`在第 %s 届%s联赛里拿到第 1 名`），
            //   不传参数 ⇒ 面板上原样显示 `%s`（2026-10-15 用户截图抓到）。参数与名字同源、同顺序 ✓
            r.cond = tr(Titles.condKey(f[0]), Titles.nameArgs(f[0]));
            out.add(r);
        }
        return out;
    }

    /**
     * 列表顺序：**已获得的在前**，其余按表序。
     *
     * <p>为什么不直接按表序：40 条里玩家手上可能只有 3 条，而界面存在的头号理由就是
     * "把手上那条戴上" —— 让他翻页去找是没道理的。未获得的**一条都没少**
     * （只是排到后面去了），所以"看条件"这件事也没被牺牲 ✓。
     * 排序是**稳定**的（同一档内保持表序），所以两次打开看到的顺序一样。
     */
    /**
     * 折叠用组键。
     *
     * <p>静态称号每条约一组（组里就它自己）；**生成式实例按「模板 + 规模」归并**，
     * 于是 {@code league_memorial@S1-large} 与 {@code @S2-large} 归到同一组 ⇒
     * 界面上一行就够，点开才展开往年（用户 2026-10-13 定案：
     * "折叠成…优先显示本赛季称号，旁边会有一个可以展开的符号，
     * 用来收录之前已经拥有的赛季称号"）。
     */
    private static String groupKeyOf(String id) {
        if (!TitleDefs.isInstance(id)) {
            return id;
        }
        int si = TitleDefs.sizeIndex(id);
        String tpl = TitleDefs.templateIdOf(id);
        return (si < 0 || tpl == null) ? id : tpl + TitleDefs.INSTANCE_SEP + TitleDefs.SIZES.get(si);
    }

    /**
     * 折叠后的列表（**界面上真正用的那一份**：一行一组 + 展开时露出往年）。
     *
     * <h2>为什么"本赛季"不用另外同步一个赛季号过来</h2>
     * 组内按**赛季号倒序**排，组首就是"手里最新的那一届"。称号是**结算时**才发的
     * （见 {@code LeagueService} 的发奖段），所以"手里最新的一届"必然就是本赛季的；
     * 没拿到本赛季的（例如本期没上榜）才退化成"上一届"—— 那正是用户那句
     * "**如果拥有**该称号，会优先显示本赛季称号"里的条件分支。
     * 为这件事再开一条同步不值得，而且会让称号界面依赖一个与称号无关的数字。
     */
    private List<Row> folded() {
        List<Row> raw = parse();
        java.util.LinkedHashMap<String, List<Row>> groups = new java.util.LinkedHashMap<>();
        for (Row r : raw) {
            groups.computeIfAbsent(groupKeyOf(r.id), k -> new ArrayList<>()).add(r);
        }
        List<Row> out = new ArrayList<>(raw.size());
        for (java.util.Map.Entry<String, List<Row>> e : groups.entrySet()) {
            List<Row> members = e.getValue();
            members.sort((a, b) -> Integer.compare(TitleDefs.seasonOf(b.id),
                    TitleDefs.seasonOf(a.id)));
            Row head = members.get(0);
            head.groupKey = e.getKey();
            head.groupSize = members.size();
            out.add(head);
            if (members.size() > 1 && expandedGroups.contains(e.getKey())) {
                for (int i = 1; i < members.size(); i++) {
                    Row c = members.get(i);
                    c.child = true;
                    c.groupKey = e.getKey();
                    out.add(c);
                }
            }
        }
        return out;
    }

    private List<Row> visible() {
        List<Row> all = folded();
        List<Row> out = new ArrayList<>(all.size());
        for (Row r : all) {
            if (r.owned) {
                out.add(r);
            }
        }
        if (!onlyOwned) {
            for (Row r : all) {
                if (!r.owned) {
                    out.add(r);
                }
            }
        }
        return out;
    }

    /** 当前页的行（渲染与点击判据共用一份，避免两处算法漂移）。 */
    private List<Row> pageRows() {
        List<Row> all = visible();
        int from = Math.min(page * rowsPerPage, all.size());
        int to = Math.min(all.size(), from + rowsPerPage);
        return all.subList(from, to);
    }

    private int pageCount() {
        return Math.max(1, (visible().size() + rowsPerPage - 1) / rowsPerPage);
    }

    /**
     * 列表每行在屏幕上的 y（第 i 行，0 起算）。
     *
     * <p>⚠ 渲染、点击、悬浮提示**都用这一个函数** —— 三处各算一遍迟早漂移，
     * 症状是"点第 2 行选中了第 3 行"（这种错极难一眼看出来）。
     */
    private int rowY(int i) {
        return top + HEADER_H + 4 + i * LIST_ROW_H;
    }

    /** 展开符号在屏幕上的位置（第 i 行）—— 渲染 / 点击 / 提示**都走这里**。 */
    private int markerX(int i) {
        return listX() + LIST_W - 18;
    }

    private int markerY(int i) {
        return rowY(i) + 2;
    }

    /** 鼠标是否落在第 i 行的展开符号方框里。 */
    private boolean overMarker(double mx, double my, int i) {
        int x = markerX(i);
        int y = markerY(i);
        return mx >= x && mx <= x + MARKER && my >= y && my <= y + MARKER;
    }

    private Row selected() {
        for (Row r : parse()) {
            if (r.id.equals(selectedId)) {
                return r;
            }
        }
        return null;
    }

    private int indexOfSelected() {
        List<Row> page = pageRows();
        for (int i = 0; i < page.size(); i++) {
            if (page.get(i).id.equals(selectedId)) {
                return i;
            }
        }
        return -1;
    }

    /** 把选中挪到第 i 行（**只选中，不做任何动作**）。 */
    private void selectIndex(int i) {
        List<Row> page = pageRows();
        if (i < 0 || i >= page.size()) {
            return;
        }
        selectedId = page.get(i).id;
        rebuild();
    }

    /**
     * 选中项被筛掉/翻页翻走了就补一个（否则详情栏空白、按钮消失，看着像界面坏了）。
     *
     * <p>⚠ 只补**可见列表里确实存在**的那一条；一条都没有就空着（空状态画字）。
     */
    private void ensureSelection() {
        for (Row r : visible()) {
            if (r.id.equals(selectedId)) {
                return;
            }
        }
        List<Row> page = pageRows();
        selectedId = page.isEmpty() ? "" : page.get(0).id;
    }

    // ------------------------------------------------------------------ 坐标
    private int listX() {
        return left + 6;
    }

    private int listTop() {
        return top + HEADER_H + 2;
    }

    private int detailX() {
        return left + 6 + LIST_W + GAP;
    }

    private int detailW() {
        return panelW - (6 + LIST_W + GAP) - 6;
    }

    private int detailButtonY() {
        return top + panelH - FOOTER_H - BTN_H - 4;
    }

    private int detailButtonX() {
        return detailX() + detailW() - BTN_W;
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
        TitlePayload snap = snap();
        lastError = snap == null ? "" : snap.lastError();
        int listX = listX();
        int listTop = listTop();
        int by = top + panelH - FOOTER_H + 3;

        // ---- 标题栏 ----
        addText(left + 6, top + 5, tr("gui.anglertackle.title_book"), C_TITLE, panelW - 12);
        if (snap != null) {
            addTextRight(left + panelW - 6, top + 5, tr("gui.anglertackle.title_counter",
                    snap.ownedCount(), snap.total()), snap.ownedCount() > 0 ? C_LABEL : C_DIM);
        }

        // ---- 页脚：筛选（左） + 按键提示（中） + 完成（右）----
        Button filter = Button.builder(Component.translatable(onlyOwned
                        ? "gui.anglertackle.title_filter_owned" : "gui.anglertackle.title_filter_all"),
                        b -> {
                            onlyOwned = !onlyOwned;
                            page = 0;
                            rebuild();
                        })
                .bounds(left + 6, by, 88, BTN_H).build();
        addRenderableWidget(filter);
        buttons.add(filter);
        Button done = Button.builder(Component.translatable("gui.anglertackle.title_done"),
                        b -> this.onClose())
                .bounds(left + panelW - 6 - 60, by, 60, BTN_H).build();
        addRenderableWidget(done);
        buttons.add(done);
        int hintX = left + 6 + 88 + 6;
        int hintAvail = (left + panelW - 6 - 60 - 6) - hintX;
        if (hintAvail > 40) {
            addText(hintX, top + panelH - FOOTER_H + 8,
                    tr("gui.anglertackle.title_hint"), C_HINT, hintAvail);
        }

        if (snap == null) {
            // 还没收到快照 —— 画"读取中"，**不画空列表**（同 CodexScreen 的理由）
            addText(listX + 6, listTop + 8, tr("gui.anglertackle.title_loading"), C_DIM, LIST_W - 12);
            return;
        }
        // 页码夹回来（窗口一变行数就变，不夹会停在空页）
        page = Math.max(0, Math.min(page, pageCount() - 1));
        ensureSelection();

        // ---- 列表 ----
        List<Row> rows = visible();
        int from = page * rowsPerPage;
        int to = Math.min(rows.size(), from + rowsPerPage);
        for (int i = from; i < to; i++) {
            Row r = rows.get(i);
            int y = rowY(i - from);
            // 往年子行缩进 10px：一眼能看出"这些是挂在上面那一行底下的"
            int tx = listX + 6 + (r.child ? 10 : 0);
            int avail = LIST_W - 34 - (r.child ? 10 : 0);
            addText(tx, y + 3, r.name, r.owned ? Quality.of(r.quality).argb() : C_HINT, avail);
            addText(tx, y + 13, qualityName(r), r.owned ? C_DIM : C_HINT, 40);
            addTextRight(listX + LIST_W - 6, y + 13, tr(statusKey(r)),
                    r.equipped ? C_TITLE : (r.owned ? C_LABEL : C_HINT));
            if (r.groupSize > 1) {
                // 折叠标记：只画在**组首**，`+` 收起 / `-` 展开。
                // 点它可以展开往年（`docs/39` §5.4）；不点则完全看不出和多届有关 ——
                // 这正是用户要的"不展开时观感跟现在一样"。
                addText(markerX(i - from), markerY(i - from),
                        expandedGroups.contains(r.groupKey) ? "-" : "+", C_LABEL, MARKER);
            }
        }
        if (rows.isEmpty()) {
            // 空状态：**两行字**，不画空列表（空列表与"界面坏了"长得一样）
            addText(listX + 6, listTop + 8, tr("gui.anglertackle.title_empty_filter"), C_DIM,
                    LIST_W - 12);
            addText(listX + 6, listTop + 20, tr("gui.anglertackle.title_empty_hint", snap.total()),
                    C_HINT, LIST_W - 12);
        }

        // ---- 详情 ----
        Row sel = selected();
        if (sel != null) {
            addDetailTexts(sel);
            Button wear = Button.builder(Component.translatable(sel.equipped
                            ? "gui.anglertackle.title_unequip" : "gui.anglertackle.title_equip"),
                            b -> toggleEquip(sel))
                    .bounds(detailButtonX(), detailButtonY(), BTN_W, BTN_H).build();
            wear.active = sel.owned;
            addRenderableWidget(wear);
            buttons.add(wear);
        } else if (!rows.isEmpty()) {
            addText(detailX() + 4, listTop + 8, tr("gui.anglertackle.title_pick"), C_HINT,
                    detailW() - 8);
        }

        // ---- 翻页条：画在**列表栏内部**（不是页脚）----
        // 页脚左边已经有筛选按钮了，两样都挤在页脚上会互相压住（邮箱界面那里就压住了 ✗）。
        int pages = pageCount();
        if (pages > 1) {
            int py = top + panelH - FOOTER_H - PAGER_H + 1;
            Button prev = Button.builder(Component.literal("<"), b -> {
                page = Math.max(0, page - 1);
                rebuild();
            }).bounds(listX, py, 18, BTN_H).build();
            prev.active = page > 0;
            addRenderableWidget(prev);
            buttons.add(prev);
            Button next = Button.builder(Component.literal(">"), b -> {
                page = Math.min(pageCount() - 1, page + 1);
                rebuild();
            }).bounds(listX + LIST_W - 18, py, 18, BTN_H).build();
            next.active = page < pages - 1;
            addRenderableWidget(next);
            buttons.add(next);
            addText(listX + 22, py + 5, tr("gui.anglertackle.title_page", page + 1, pages),
                    C_HINT, LIST_W - 44);
        }
    }

    /** 详情栏的所有文字（条件会自动折行，最多 4 行）。 */
    private void addDetailTexts(Row r) {
        int x = detailX();
        int w = detailW();
        int top0 = listTop();
        addText(x + 4, top0 + 3, r.name, r.owned ? Quality.of(r.quality).argb() : C_HINT, w - 8);
        addText(x + 4, top0 + 15, tr("gui.anglertackle.title_quality", qualityName(r))
                + " · " + tr(statusKey(r)), C_LABEL, w - 8);
        addText(x + 4, top0 + 31, tr("gui.anglertackle.title_cond"), C_LABEL, w - 8);
        int ty = top0 + 43;
        int maxLines = Math.max(1, Math.min(4, (detailButtonY() - 44 - ty) / 10));
        for (String line : wrap(r.cond, Math.max(40, w - 8), maxLines)) {
            addText(x + 4, ty, line, C_TEXT, w - 8);
            ty += 10;
        }
        if (r.holders > 0) {
            String who = String.join("、", r.names);
            addText(x + 4, detailButtonY() - 22, who.isEmpty()
                            ? tr("gui.anglertackle.title_holders", r.holders)
                            : tr("gui.anglertackle.title_holders_names", r.holders, who),
                    C_DIM, w - 8);
        } else {
            addText(x + 4, detailButtonY() - 22, tr("gui.anglertackle.title_holders_none"), C_HINT,
                    w - 8);
        }
        // ⚠ "获得次数"那一行只有在**不压到条件文本**时才画：面板被压到最低高度时
        //   它俩会叠在一起（叠字比少一行难看得多）
        int timesY = detailButtonY() - 33;
        if (r.repeatable && r.count > 1 && timesY >= ty + 2) {
            addText(x + 4, timesY, tr("gui.anglertackle.title_times", r.count), C_DIM, w - 8);
        }
        // 上一次动作失败了 ⇒ 在按钮上方说明原因（不然玩家只看到"点了没反应"）
        if (!lastError.isEmpty()) {
            addText(x + 4, detailButtonY() - 11,
                    tr("gui.anglertackle.title_err_" + lastError), C_ERR, w - 8);
        }
    }

    /**
     * 行右侧那个状态词。
     *
     * <p>顺序不能变：**佩戴中 &gt; 已获得 &gt; 未获得**（第一个成立的就用）。
     * 写成别的顺序就会出现"正戴着的那条显示成未获得"这种自相矛盾的状态。
     */
    private static String statusKey(Row r) {
        if (r.equipped) {
            return "gui.anglertackle.title_wearing";
        }
        return r.owned ? "gui.anglertackle.title_owned" : "gui.anglertackle.title_locked";
    }

    /** 品质名（白/绿/蓝/紫/金/红）—— 与 tooltip、图鉴共用一个键，不另抄一份。 */
    private static String qualityName(Row r) {
        return tr("tooltip.anglertackle.quality." + Quality.of(r.quality).key());
    }

    /**
     * 按字体宽度折行，最多 {@code maxLines} 行，最后一行超出就截断。
     *
     * <p>为什么不用 {@code font.split(...)}：它返回的是 {@code FormattedCharSequence}
     * （不是字符串），而这里每一行都要交给 {@link TextWidget}（收字符串）。
     * 硬要转一道反而多一层容易错的代码 —— 条件那句话本来就只有几十个字，
     * 按字符累加宽度就够了，中英混排都算得准（宽度表来自字体本身）。
     */
    private List<String> wrap(String text, int maxWidth, int maxLines) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (cur.length() > 0 && this.font.width(cur.toString() + c) > maxWidth) {
                if (out.size() == maxLines - 1) {
                    cur.append(c);      // 最后一行：让它继续长，交回给 UiLayout.fitText 截断
                    continue;
                }
                out.add(cur.toString());
                cur.setLength(0);
            }
            cur.append(c);
        }
        if (cur.length() > 0) {
            out.add(cur.toString());
        }
        return out;
    }

    private static String tr(String key, Object... args) {
        return Component.translatable(key, args).getString();
    }

    /**
     * 加一行文字。
     *
     * <p>⚠ y 就是**实际画出来的那一行**的 y：{@link TextWidget} 内部会按
     * {@code (height - 8) / 2} 再往下挪一点，所以这里先减掉那个偏移，
     * 免得同一块版面上"有的行偏 2px、有的行不偏"。
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

    /** 右对齐的一行（宽度按**实际文字**算：换语言变长时不会顶着边框出屏）。 */
    private void addTextRight(int right, int y, String text, int color) {
        int w = Minecraft.getInstance().font.width(text);
        addText(right - w, y, text, color, w + 2);
    }

    /** 佩戴 / 摘下（**只发动作包**，能不能戴由服务端判 —— 客户端不自己改状态）。 */
    private void toggleEquip(Row r) {
        ClientPacketDistributor.sendToServer(new TitleActionPayload(
                r.equipped ? TitleActionPayload.UNEQUIP : TitleActionPayload.EQUIP, r.id));
    }

    /** 服务端推来新快照时由 handler 调用（保持选中与页码，刷新内容）。 */
    public void refresh() {
        rebuild();
    }

    // ------------------------------------------------------------------ 渲染
    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        // 背景由 extractBackground 提前抽取，这里只画内容。
        // 面板 + 边框（外深内亮，与既有界面一致）
        g.fill(left - 1, top - 1, left + panelW + 1, top + panelH + 1, C_SHADOW);
        g.fill(left, top, left + panelW, top + panelH, C_PANEL);
        g.fill(left, top, left + panelW, top + 1, C_LINE);
        g.fill(left, top + panelH - 1, left + panelW, top + panelH, C_LINE);
        g.fill(left, top, left + 1, top + panelH, C_LINE);
        g.fill(left + panelW - 1, top, left + panelW, top + panelH, C_LINE);

        int listX = listX();
        int listTop = listTop();
        // 两块面板的底
        g.fill(listX - 1, listTop - 1, listX + LIST_W + 1, top + panelH - FOOTER_H, C_TRACK);
        g.fill(detailX() - 1, listTop - 1, detailX() + detailW() + 1, top + panelH - FOOTER_H, C_TRACK);

        // 列表行的底色/色带（文字在 widget 里，这里只画"底"）
        List<Row> page = pageRows();
        if (snap() != null && !page.isEmpty()) {
            // 详情栏的分隔线（文字是 widget，线得自己画）——
            // 只在**真的选了东西**时画，否则空详情栏上会横着一条莫名其妙的线
            g.fill(detailX() + 4, listTop + 26, detailX() + detailW() - 4, listTop + 27, C_LINE);
        }
        for (int i = 0; i < page.size(); i++) {
            Row r = page.get(i);
            int y = rowY(i);
            if (r.id.equals(selectedId)) {
                g.fill(listX, y, listX + LIST_W, y + LIST_ROW_H - 2, C_SEL);
            }
            // 档位色带：**已获得 = Quality 的颜色**，没拿到 = 轨道灰（一眼分得出哪些是自己的）
            g.fill(listX, y, listX + BAR_W, y + LIST_ROW_H - 2,
                    r.owned ? Quality.of(r.quality).argb() : C_TRACK);
        }

        // ⚠ **不要调 super.extractRenderState(...)**：背景已由 extractBackground 提前抽取，
        //   再调一次会让全屏暗化盖在面板与文字上（守着这条的是 tools/check-screen-render.js）。
        for (net.minecraft.client.gui.components.Renderable r : this.renderables) {
            r.extractRenderState(g, mouseX, mouseY, partialTick);
        }
        renderHoverTips(g, mouseX, mouseY);
    }

    /**
     * 悬浮提示（划过**只显示提示**，绝不改状态 —— 点行才选中，佩戴要按按钮/回车）。
     */
    private void renderHoverTips(GuiGraphicsExtractor g, int mouseX, int mouseY) {
        int listX = listX();
        List<Row> page = pageRows();
        for (int i = 0; i < page.size(); i++) {
            int y = rowY(i);
            if (mouseX >= listX && mouseX <= listX + LIST_W
                    && mouseY >= y && mouseY <= y + LIST_ROW_H - 2) {
                Row r = page.get(i);
                List<Component> tip = new ArrayList<>();
                tip.add(Component.literal(r.name).withStyle(r.owned
                        ? Quality.of(r.quality).color() : net.minecraft.ChatFormatting.DARK_GRAY));
                tip.add(Component.translatable("gui.anglertackle.title_quality", qualityName(r))
                        .withStyle(net.minecraft.ChatFormatting.GRAY));
                tip.add(Component.literal(r.cond).withStyle(net.minecraft.ChatFormatting.WHITE));
                if (r.holders > 0) {
                    tip.add(Component.translatable("gui.anglertackle.title_holders", r.holders)
                            .withStyle(net.minecraft.ChatFormatting.GRAY));
                }
                if (r.groupSize > 1) {
                    // 折叠提示：把"这一组有几届 / 点方框会怎样"说清楚 ——
                    // 光画一个 [+] 没人知道点它会发生什么。
                    // 两种状态用**两个键**（而不是传 1/0 进一个键）：翻译里做条件的写法
                    // 在英文语序下会拧巴，仓库一贯是"一句话一个键"。
                    tip.add(Component.translatable(expandedGroups.contains(r.groupKey)
                                    ? "gui.anglertackle.title_seasons_tip_expanded"
                                    : "gui.anglertackle.title_seasons_tip_collapsed", r.groupSize)
                            .withStyle(net.minecraft.ChatFormatting.AQUA));
                }
                tip.add(Component.translatable("gui.anglertackle.title_tip_pick")
                        .withStyle(net.minecraft.ChatFormatting.DARK_GRAY));
                g.setComponentTooltipForNextFrame(this.font, tip, mouseX, mouseY);
                return;
            }
        }
    }

    // ------------------------------------------------------------------ 输入
    /** 点列表行 = 只选中（**不自动佩戴** —— 误触就换掉身份比误领附件更烦人）。 */
    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        double mx = event.x();
        double my = event.y();
        int button = event.button();
        int listX = listX();
        List<Row> rows = pageRows();
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            int y = rowY(i);
            if (mx >= listX && mx <= listX + LIST_W && my >= y && my <= y + LIST_ROW_H - 2) {
                // 点展开符号 = 只展开/收起，**不改变选中**（误触不该把详情栏跳走）
                if (r.groupSize > 1 && overMarker(mx, my, i)) {
                    boolean open;
                    if (expandedGroups.remove(r.groupKey)) {
                        open = false;
                    } else {
                        expandedGroups.add(r.groupKey);
                        open = true;
                    }
                    // 收起时若正选着这一组里的"往年"那一行，把选中挪回组首 ——
                    // 否则那一行被折掉了，详情栏会突然空掉，看着像界面坏了
                    if (!open && groupKeyOf(selectedId).equals(r.groupKey)) {
                        selectedId = r.id;
                    }
                    rebuild();
                    return true;
                }
                selectIndex(i);
                return true;
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    /** 滚轮翻页（与那对小按钮共用同一个 page 变量 —— 两条路不会各翻各的）。 */
    @Override
    public boolean mouseScrolled(double mx, double my, double dx, double dy) {
        if (snap() == null) {
            return super.mouseScrolled(mx, my, dx, dy);
        }
        int next = page + (dy < 0 ? 1 : -1);
        if (next >= 0 && next < pageCount() && next != page) {
            page = next;
            rebuild();
            return true;
        }
        return super.mouseScrolled(mx, my, dx, dy);
    }

    /**
     * 键盘：↑/↓ 选、Enter 佩戴/摘下、`U` 摘下、`F` 切换筛选、Esc 关闭（父类默认）。
     *
     * <p>⚠ 这几条与点击/按钮**完全等价** —— 不是另一套逻辑
     * （那样两条路的判定迟早分叉）。
     */
    @Override
    public boolean keyPressed(KeyEvent event) {
        int keyCode = event.key();
        int sel = indexOfSelected();
        switch (keyCode) {
            case 265 -> {   // ↑
                selectIndex(sel < 0 ? 0 : Math.max(0, sel - 1));
                return true;
            }
            case 264 -> {   // ↓
                selectIndex(sel < 0 ? 0 : Math.min(pageRows().size() - 1, sel + 1));
                return true;
            }
            case 257, 335 -> {   // Enter / 小键盘回车 = 佩戴/摘下选中的那条
                Row r = selected();
                if (r != null && r.owned) {
                    toggleEquip(r);
                    return true;
                }
                return false;
            }
            case 85 -> {    // U = 摘下（不管现在选的是哪条）
                ClientPacketDistributor.sendToServer(
                        new TitleActionPayload(TitleActionPayload.UNEQUIP, ""));
                return true;
            }
            case 70 -> {    // F = 只看已获得 / 显示全部
                onlyOwned = !onlyOwned;
                page = 0;
                rebuild();
                return true;
            }
            default -> {
                return super.keyPressed(event);
            }
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
